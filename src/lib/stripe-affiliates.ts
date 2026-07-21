import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/server-access";
import {
  stripeId,
  type InvoiceWithLegacySubscription,
} from "@/lib/stripe-webhook";

export async function recordAffiliateAttribution(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<boolean> {
  let needsRetry = false;
  const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["discounts"],
  });
  const promotionCodeId =
    (fullSession.discounts ?? [])
      .map((discount) =>
        typeof discount.promotion_code === "string"
          ? discount.promotion_code
          : discount.promotion_code?.id ?? null
      )
      .find(Boolean) ?? null;
  if (!promotionCodeId) return false;

  const { data: affiliate } = await supabaseAdmin
    .from("affiliates")
    .select("id, commission_rate, status, email")
    .eq("stripe_promotion_code_id", promotionCodeId)
    .maybeSingle();
  if (!affiliate || (affiliate.status ?? "active") !== "active") return false;

  const buyerEmail = (session.customer_details?.email || session.customer_email || "")
    .trim()
    .toLowerCase();
  const affiliateEmail = (affiliate.email || "").trim().toLowerCase();
  if (buyerEmail && affiliateEmail && buyerEmail === affiliateEmail) {
    console.warn("Affiliate self-referral blocked", { affiliateId: affiliate.id });
    return false;
  }

  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);
  let referralId: string | null = null;

  if (subscriptionId) {
    const { data, error } = await supabaseAdmin
      .from("referrals")
      .upsert(
        {
          affiliate_id: affiliate.id,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        },
        { onConflict: "stripe_subscription_id" }
      )
      .select("id")
      .single();
    if (error) {
      console.error("Affiliate referral upsert failed", error);
      needsRetry = true;
    }
    referralId = data?.id ?? null;
  } else {
    const { data, error } = await supabaseAdmin
      .from("referrals")
      .insert({
        affiliate_id: affiliate.id,
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("Affiliate referral insert failed", error);
      needsRetry = true;
    }
    referralId = data?.id ?? null;
  }

  const invoiceReference =
    stripeId(session.invoice) ?? stripeId(session.payment_intent) ?? session.id;
  const amountTotal = session.amount_total ?? 0;
  const rate = Number(affiliate.commission_rate ?? 0.3);

  if (referralId && amountTotal > 0 && rate > 0) {
    const { data: existing } = await supabaseAdmin
      .from("commissions")
      .select("id")
      .eq("stripe_invoice_id", invoiceReference)
      .maybeSingle();
    if (!existing) {
      const amountCents = Math.round(amountTotal * rate);
      const { error } = await supabaseAdmin.from("commissions").insert({
        affiliate_id: affiliate.id,
        referral_id: referralId,
        stripe_invoice_id: invoiceReference,
        amount_cents: amountCents,
        currency: session.currency ?? "usd",
        status: "pending",
      });
      if (error && error.code !== "23505") {
        console.error("Affiliate commission insert failed", error);
        needsRetry = true;
      } else if (!error) {
        console.info("Affiliate first-payment commission recorded", {
          affiliateId: affiliate.id,
          amountCents,
        });
      }
    }
  }

  return needsRetry;
}

export async function recordRenewalCommission(
  invoice: InvoiceWithLegacySubscription,
  subscriptionId: string
): Promise<boolean> {
  const { data: referral } = await supabaseAdmin
    .from("referrals")
    .select("id, affiliate_id, affiliates(commission_rate, status)")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  const affiliate = Array.isArray(referral?.affiliates)
    ? referral.affiliates[0]
    : referral?.affiliates;
  if (!referral || !affiliate || (affiliate.status ?? "active") !== "active") {
    return false;
  }

  const invoiceId = invoice.id ?? null;
  const amountPaid = invoice.amount_paid ?? 0;
  const rate = Number(affiliate.commission_rate ?? 0.3);
  if (!invoiceId || amountPaid <= 0 || rate <= 0) return false;

  const { data: existing } = await supabaseAdmin
    .from("commissions")
    .select("id")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();
  if (existing) return false;

  const amountCents = Math.round(amountPaid * rate);
  const { error } = await supabaseAdmin.from("commissions").insert({
    affiliate_id: referral.affiliate_id,
    referral_id: referral.id,
    stripe_invoice_id: invoiceId,
    amount_cents: amountCents,
    currency: invoice.currency ?? "usd",
    status: "pending",
  });
  if (error && error.code !== "23505") {
    console.error("Affiliate renewal commission insert failed", error);
    return true;
  }
  if (!error) {
    console.info("Affiliate renewal commission recorded", {
      affiliateId: referral.affiliate_id,
      invoiceId,
      amountCents,
    });
  }
  return false;
}

export async function voidCommissionsForRefs(
  references: Array<string | null | undefined>,
  reason: string
): Promise<boolean> {
  const ids = [...new Set(references.filter((value): value is string => Boolean(value)))];
  if (ids.length === 0) return false;

  const { data: voided, error } = await supabaseAdmin
    .from("commissions")
    .update({ status: "void" })
    .in("stripe_invoice_id", ids)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("Commission void failed", error);
    return true;
  }
  if (voided && voided.length > 0) {
    console.info("Pending affiliate commissions voided", {
      count: voided.length,
      reason,
      references: ids,
    });
  }

  const { data: paid } = await supabaseAdmin
    .from("commissions")
    .select("id, amount_cents, affiliate_id")
    .in("stripe_invoice_id", ids)
    .eq("status", "paid");
  for (const commission of paid ?? []) {
    console.warn("Manual affiliate commission clawback required", {
      commissionId: commission.id,
      affiliateId: commission.affiliate_id,
      amountCents: commission.amount_cents,
      reason,
    });
  }
  return false;
}
