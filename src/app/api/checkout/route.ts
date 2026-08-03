import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { hasPaidPlan, isReferralCode, normalizeReferralCode } from "@/lib/buddy-pass";
import { allowRequestRate, requestAccess, supabaseAdmin } from "@/lib/server-access";
import { siteOrigin } from "@/lib/site-url";
import { currentCheckoutPriceIds, paidPlanFromPriceId } from "@/lib/stripe-plans";
import { stripeClient } from "@/lib/stripe-server";
import { isCurrentSubscription } from "@/lib/stripe-subscriptions";

async function buddyPassCouponId(stripe: Stripe) {
  const configuredCoupon = process.env.STRIPE_BUDDY_PASS_COUPON_ID;
  if (configuredCoupon) {
    const coupon = await stripe.coupons.retrieve(configuredCoupon);
    assertBuddyPassCoupon(coupon);
    return configuredCoupon;
  }

  const couponId = "research_buddy_pass_25";
  try {
    const coupon = await stripe.coupons.retrieve(couponId);
    assertBuddyPassCoupon(coupon);
    return couponId;
  } catch (error) {
    if (!isMissingStripeResource(error)) throw error;
    try {
      const coupon = await stripe.coupons.create({
        id: couponId,
        name: "Research Buddy Pass",
        percent_off: 25,
        duration: "once",
      });
      assertBuddyPassCoupon(coupon);
      return coupon.id;
    } catch {
      const coupon = await stripe.coupons.retrieve(couponId);
      assertBuddyPassCoupon(coupon);
      return couponId;
    }
  }
}

function isMissingStripeResource(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "resource_missing"
  );
}

function assertBuddyPassCoupon(coupon: Stripe.Coupon | Stripe.DeletedCoupon) {
  if (
    "deleted" in coupon ||
    !coupon.valid ||
    coupon.percent_off !== 25 ||
    coupon.duration !== "once"
  ) {
    throw new Error("The configured Buddy Pass coupon must be valid, 25% off, and apply once.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const stripe = stripeClient();
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "You must be signed in to start checkout." }, { status: 401 });
    }
    const userId = access.user.id;
    if (!(await allowRequestRate(req, "checkout", 5, userId, 600))) {
      return NextResponse.json({ error: "Too many checkout attempts. Try again in a few minutes." }, { status: 429 });
    }

    const { priceId, referralCode } = await req.json();
    if (typeof priceId !== "string" || !currentCheckoutPriceIds().has(priceId)) {
      return NextResponse.json({ error: "Invalid checkout price." }, { status: 400 });
    }

    const plan = paidPlanFromPriceId(priceId);
    if (!plan) {
      return NextResponse.json({ error: "Checkout price is not mapped to an access plan." }, { status: 500 });
    }
    if (access.profile?.plan_type === "lifetime") {
      return NextResponse.json({ error: "Your account already has lifetime access." }, { status: 409 });
    }
    if (plan !== "lifetime" && hasPaidPlan(access.profile)) {
      return NextResponse.json(
        { error: "Your account already has paid access. Manage the current plan from your profile." },
        { status: 409 }
      );
    }

    // Determine if this is a subscription or one-time based on the price
    const price = await stripe.prices.retrieve(priceId);
    const mode = price.type === "recurring" ? "subscription" : "payment";
    if (mode === "subscription") {
      const subscriptions = await stripe.subscriptions.search({
        query: `metadata['userId']:'${userId.replace(/'/g, "\\'")}'`,
        limit: 100,
      });
      if (subscriptions.data.some(isCurrentSubscription)) {
        return NextResponse.json(
          { error: "You already have an active subscription. Manage it from your profile." },
          { status: 409 }
        );
      }
    }

    let referralMetadata: Record<string, string> = {};
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;

    if (typeof referralCode === "string" && referralCode.trim()) {
      const normalizedReferralCode = normalizeReferralCode(referralCode);
      if (!isReferralCode(normalizedReferralCode)) {
        return NextResponse.json({ error: "Enter a valid Buddy Pass code." }, { status: 400 });
      }
      const { data: referrer, error: referrerError } = await supabaseAdmin
        .from("profiles")
        .select("id, referral_code")
        .eq("referral_code", normalizedReferralCode)
        .maybeSingle();

      if (referrerError) {
        console.error("Buddy Pass referrer lookup failed", referrerError);
        return NextResponse.json(
          { error: "Could not verify that Buddy Pass code. Please try again." },
          { status: 503 }
        );
      }
      if (!referrer) {
        return NextResponse.json({ error: "Buddy Pass code not found." }, { status: 400 });
      }
      if (referrer.id === userId) {
        return NextResponse.json({ error: "You cannot use your own Buddy Pass code." }, { status: 400 });
      }

      const { data: existingReferral, error: existingReferralError } = await supabaseAdmin
        .from("buddy_pass_referrals")
        .select("id")
        .eq("referred_user_id", userId)
        .eq("status", "rewarded")
        .limit(1)
        .maybeSingle();

      if (existingReferralError) {
        console.error("Buddy Pass prior-use lookup failed", existingReferralError);
        return NextResponse.json(
          { error: "Could not verify Buddy Pass eligibility. Please try again." },
          { status: 503 }
        );
      }
      if (existingReferral) {
        return NextResponse.json({ error: "You already used a Buddy Pass code." }, { status: 400 });
      }

      referralMetadata = {
        referralCode: normalizedReferralCode,
        referrerId: referrer.id,
        referredUserId: userId,
      };
      discounts = [{ coupon: await buddyPassCouponId(stripe) }];
    }

    const metadata = { userId, ...referralMetadata };
    const origin = siteOrigin();

    const session = await stripe.checkout.sessions.create(
      {
        mode,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: userId,
        customer_email: access.user.email ?? undefined,
        metadata,
        ...(mode === "subscription" ? { subscription_data: { metadata } } : {}),
        ...(discounts ? { discounts } : { allow_promotion_codes: true }),
        success_url: `${origin}/welcome`,
        cancel_url: `${origin}/app`,
      },
      {
        idempotencyKey: `checkout:${userId}:${priceId}:${normalizeReferralCode(typeof referralCode === "string" ? referralCode : "")}:${Math.floor(Date.now() / 600_000)}`,
      }
    );

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    return NextResponse.json({ error: "Could not start checkout. Please try again or contact support." }, { status: 500 });
  }
}
