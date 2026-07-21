import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/server-access";
import { paidPlanFromPriceId, type PaidPlanType, verifiedUserId } from "@/lib/stripe-plans";
import { stripeClient, stripeWebhookSecret } from "@/lib/stripe-server";
import { isCurrentSubscription } from "@/lib/stripe-subscriptions";
import {
  downgradeToFree,
  provisionPlan,
  revokeAccessForPaymentIntent,
  userIdFromSubscription,
} from "@/lib/stripe-access";
import {
  recordAffiliateAttribution,
  recordRenewalCommission,
  voidCommissionsForRefs,
} from "@/lib/stripe-affiliates";
import {
  invoiceRefsForPaymentIntent,
  type InvoiceWithLegacySubscription,
  stripeId,
  subscriptionIdFromInvoice,
} from "@/lib/stripe-webhook";

function retryResponse() {
  return NextResponse.json(
    { error: "transient failure, please retry" },
    { status: 500 }
  );
}

export async function POST(req: NextRequest) {
  let stripe: Stripe;
  let webhookSecret: string;
  try {
    stripe = stripeClient();
    webhookSecret = stripeWebhookSecret();
  } catch (error) {
    console.error("Stripe webhook configuration error", error);
    return retryResponse();
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Claim the event before processing. Failed handlers remain retryable, while
  // completed events are acknowledged without repeating financial side effects.
  const { data: claimState, error: guardError } = await supabaseAdmin.rpc(
    "claim_stripe_event",
    { p_event_id: event.id }
  );
  if (claimState === "completed") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (guardError || claimState !== "claimed") {
    console.error("Stripe event claim failed", { eventId: event.id, guardError });
    return retryResponse();
  }

  let needsRetry = false;

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      let planType: PaidPlanType | null = null;
      let paidPriceId: string | null = null;

      if (session.mode === "payment") {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
          limit: 1,
        });
        paidPriceId = lineItems.data[0]?.price?.id ?? null;
        planType = paidPlanFromPriceId(paidPriceId);
      } else if (session.mode === "subscription") {
        const subscriptionId = stripeId(session.subscription);
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          paidPriceId = subscription.items.data[0]?.price.id ?? null;
          planType = paidPlanFromPriceId(paidPriceId);
        }
      }

      // Affiliate accounting is independent of profile provisioning: the creator
      // earned commission when the payment succeeded, even if account repair retries.
      try {
        needsRetry =
          (await recordAffiliateAttribution(stripe, session)) || needsRetry;
      } catch (error) {
        console.error("Affiliate attribution failed", error);
        needsRetry = true;
      }

      const userId =
        verifiedUserId(session.metadata?.userId) ??
        verifiedUserId(session.client_reference_id);
      if (!userId) {
        console.warn("Checkout has no verified Research Match user ID", {
          sessionId: session.id,
        });
      } else if (!planType) {
        console.error("Checkout uses an unmapped Stripe price", {
          sessionId: session.id,
          priceId: paidPriceId,
        });
        needsRetry = true;
      } else {
        const provisioned = await provisionPlan(userId, planType);
        if (provisioned.error) {
          console.error("Plan provisioning failed", {
            userId,
            planType,
            error: provisioned.error,
          });
          needsRetry = true;
        } else {
          console.info(
            provisioned.keptLifetime
              ? "Existing lifetime access preserved"
              : "Paid access provisioned",
            { userId, planType }
          );

          if (planType === "lifetime") {
            try {
              const subscriptions = await stripe.subscriptions.search({
                query: `metadata['userId']:'${userId.replace(/'/g, "\\'")}'`,
                limit: 100,
              });
              for (const subscription of subscriptions.data) {
                if (isCurrentSubscription(subscription)) {
                  await stripe.subscriptions.cancel(subscription.id);
                }
              }
            } catch (error) {
              console.error("Replaced subscription cancellation failed", {
                userId,
                error,
              });
              needsRetry = true;
            }
          }

          const referrerId = verifiedUserId(session.metadata?.referrerId);
          const referralCode = session.metadata?.referralCode;
          const isValidBuddyPass =
            referrerId &&
            referralCode &&
            session.metadata?.referredUserId === userId &&
            referrerId !== userId;
          if (isValidBuddyPass) {
            try {
              const { data: granted, error: rewardError } = await supabaseAdmin.rpc(
                "record_buddy_pass_reward",
                {
                  p_referrer_id: referrerId,
                  p_referred_user_id: userId,
                  p_referral_code: referralCode,
                  p_checkout_session_id: session.id,
                  p_stripe_customer_id: stripeId(session.customer),
                  p_price_id: paidPriceId,
                }
              );
              if (rewardError) {
                console.error("Buddy Pass reward transaction failed", rewardError);
                needsRetry = true;
              } else if (granted) {
                console.info("Buddy Pass reward granted", { referrerId, userId });
              }
            } catch (error) {
              console.error("Buddy Pass reward failed", error);
              needsRetry = true;
            }
          }
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await userIdFromSubscription(stripe, subscription.id);
      if (userId) {
        const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
        if (!endedPlan) {
          throw new Error(
            `Unrecognized deleted subscription price for ${subscription.id}`
          );
        }
        needsRetry =
          (await downgradeToFree(userId, endedPlan, "Subscription deleted")) ||
          needsRetry;
      }
    }

    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const terminalStatuses: Stripe.Subscription.Status[] = [
        "unpaid",
        "canceled",
        "incomplete_expired",
      ];
      if (terminalStatuses.includes(subscription.status)) {
        const userId = await userIdFromSubscription(stripe, subscription.id);
        if (userId) {
          const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
          if (!endedPlan) {
            throw new Error(
              `Unrecognized updated subscription price for ${subscription.id}`
            );
          }
          needsRetry =
            (await downgradeToFree(
              userId,
              endedPlan,
              `Subscription status "${subscription.status}"`
            )) || needsRetry;
        }
      }
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as InvoiceWithLegacySubscription;
      if (invoice.billing_reason === "subscription_cycle") {
        const subscriptionId = subscriptionIdFromInvoice(invoice);
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          if (!subscription.cancel_at_period_end) {
            const userId = await userIdFromSubscription(stripe, subscriptionId);
            if (userId) {
              const planType = paidPlanFromPriceId(
                subscription.items.data[0]?.price.id
              );
              if (!planType) {
                throw new Error(`Unrecognized renewal price for ${subscriptionId}`);
              }

              // A renewal cannot lower access granted by a stronger plan.
              const outrankingPlans =
                planType === "weekly"
                  ? '("lifetime","semester")'
                  : '("lifetime")';
              const { error: renewalError } = await supabaseAdmin
                .from("profiles")
                .update({ plan_type: planType, plan_expires_at: null })
                .eq("id", userId)
                .not("plan_type", "in", outrankingPlans);
              if (renewalError) {
                console.error("Renewal access update failed", {
                  userId,
                  planType,
                  error: renewalError,
                });
                needsRetry = true;
              } else {
                console.info("Renewal access confirmed", { userId, planType });
              }
            }
          }

          try {
            needsRetry =
              (await recordRenewalCommission(invoice, subscriptionId)) ||
              needsRetry;
          } catch (error) {
            console.error("Affiliate renewal commission failed", error);
            needsRetry = true;
          }
        }
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as InvoiceWithLegacySubscription;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (subscriptionId) {
        const userId = await userIdFromSubscription(stripe, subscriptionId);
        console.info("Payment failed; grace-period access preserved", {
          userId,
          subscriptionId,
        });
      }
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge & {
        invoice?: string | Stripe.Invoice | null;
      };
      if (charge.amount_refunded >= charge.amount) {
        const paymentIntentId = stripeId(charge.payment_intent);
        const invoiceIds = await invoiceRefsForPaymentIntent(
          stripe,
          paymentIntentId
        );
        needsRetry =
          (await voidCommissionsForRefs(
            [stripeId(charge.invoice), paymentIntentId, ...invoiceIds],
            "refund"
          )) || needsRetry;
        needsRetry =
          (await revokeAccessForPaymentIntent(
            stripe,
            paymentIntentId,
            "Full refund"
          )) || needsRetry;
      }
    }

    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const paymentIntentId = stripeId(dispute.payment_intent);
      const references: Array<string | null> = [
        paymentIntentId,
        ...(await invoiceRefsForPaymentIntent(stripe, paymentIntentId)),
      ];
      const chargeId = stripeId(dispute.charge);
      if (chargeId) {
        try {
          const charge = (await stripe.charges.retrieve(chargeId)) as Stripe.Charge & {
            invoice?: string | Stripe.Invoice | null;
          };
          const chargePaymentIntentId = stripeId(charge.payment_intent);
          references.push(
            stripeId(charge.invoice),
            chargePaymentIntentId,
            ...(await invoiceRefsForPaymentIntent(stripe, chargePaymentIntentId))
          );
        } catch (error) {
          console.error("Disputed charge lookup failed", { chargeId, error });
          needsRetry = true;
        }
      }
      needsRetry =
        (await voidCommissionsForRefs(references, "dispute")) || needsRetry;
    }
  } catch (error) {
    console.error("Unhandled Stripe webhook error", {
      eventId: event.id,
      eventType: event.type,
      error,
    });
    needsRetry = true;
  }

  if (needsRetry) {
    await supabaseAdmin
      .from("processed_stripe_events")
      .update({
        status: "failed",
        last_error: `Handler failed for ${event.type}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return retryResponse();
  }

  const { data: completedEvent, error: completeError } = await supabaseAdmin
    .from("processed_stripe_events")
    .update({
      status: "completed",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (completeError || !completedEvent) {
    console.error("Stripe event completion failed", {
      eventId: event.id,
      completeError,
    });
    return retryResponse();
  }

  return NextResponse.json({ received: true });
}
