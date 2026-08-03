import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/server-access";
import { stripeId, type InvoiceWithLegacySubscription } from "@/lib/stripe-webhook";

export async function recordAffiliateAttribution(
  session: Stripe.Checkout.Session
): Promise<boolean> {
  let needsRetry = false;
  const promotionCodeId =
    (session.discounts ?? [])
      .map((discount) => {
        if (typeof discount === "string") return null;
        const promotionCode = discount.promotion_code;
        return typeof promotionCode === "string" ? promotionCode : promotionCode?.id ?? null;
      })
      .find(Boolean) ?? null;
  if (!promotionCodeId) return false;

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from("affiliates")
    .select("id, commission_rate, status, email")
    .eq("stripe_promotion_code_id", promotionCodeId)
    .maybeSingle();
  if (affiliateError) {
    throw new Error(`Affiliate lookup failed: ${affiliateError.message}`);
  }
  if (!affiliate || (affiliate.status ?? "active") !== "active") return false;

  const buyerEmail = (session.customer_details?.email || session.customer_email || "")
    .trim()
    .toLowerCase();
  const affiliateEmail = (affiliate.email || "").trim().toLowerCase();
  if (buyerEmail && affiliateEmail && buyerEmail === affiliateEmail) {
    console.warn("Affiliate self-referral blocked", {
      affiliateId: affiliate.id,
    });
    return false;
  }

  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);
  let referralId: string | null = null;

  const { data: referral, error: referralError } = await supabaseAdmin
    .from("referrals")
    .insert({
      affiliate_id: affiliate.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_checkout_session_id: session.id,
    })
    .select("id")
    .single();
  referralId = referral?.id ?? null;

  if (referralError && referralError.code === "23505") {
    // Production has first-touch uniqueness on Stripe customer IDs, and legacy
    // rows can already be keyed by subscription. Recover an existing
    // same-affiliate row without ever overwriting its original attribution.
    const candidates: Array<
      [
        "stripe_checkout_session_id" | "stripe_subscription_id" | "stripe_customer_id",
        string | null
      ]
    > = [
      ["stripe_checkout_session_id", session.id],
      ["stripe_subscription_id", subscriptionId],
      ["stripe_customer_id", customerId],
    ];
    let conflictBelongsToAnotherAffiliate = false;
    for (const [column, value] of candidates) {
      if (!value || referralId || conflictBelongsToAnotherAffiliate) continue;
      const { data: existingReferral, error: existingReferralError } = await supabaseAdmin
        .from("referrals")
        .select("id, affiliate_id")
        .eq(column, value)
        .maybeSingle();
      if (existingReferralError) {
        console.error("Existing affiliate referral lookup failed", existingReferralError);
        needsRetry = true;
        break;
      }
      if (existingReferral) {
        if (existingReferral.affiliate_id === affiliate.id) {
          referralId = existingReferral.id;
        } else {
          conflictBelongsToAnotherAffiliate = true;
          console.warn("Affiliate attribution preserved for original referrer", {
            checkoutSessionId: session.id,
          });
        }
      }
    }
    if (!referralId && !conflictBelongsToAnotherAffiliate && !needsRetry) {
      console.error("Affiliate referral uniqueness conflict could not be resolved", referralError);
      needsRetry = true;
    }
  } else if (referralError) {
    console.error("Affiliate referral insert failed", referralError);
    needsRetry = true;
  }

  const invoiceReference =
    stripeId(session.invoice) ?? stripeId(session.payment_intent) ?? session.id;
  const amountTotal = session.amount_total ?? 0;
  const rate = Number(affiliate.commission_rate ?? 0.3);

  if (referralId && amountTotal > 0 && rate > 0) {
    const { data: commission, error } = await supabaseAdmin.rpc("record_affiliate_commission", {
      p_affiliate_id: affiliate.id,
      p_referral_id: referralId,
      p_stripe_reference: invoiceReference,
      p_gross_amount_cents: amountTotal,
      p_currency: session.currency ?? "usd",
      p_commission_rate: rate,
    });
    if (error) {
      console.error("Affiliate first-payment commission transaction failed", error);
      needsRetry = true;
    } else if (commission?.inserted) {
      console.info("Affiliate first-payment commission recorded", {
        affiliateId: affiliate.id,
        amountCents: commission.amount_cents,
        status: commission.status,
      });
    }
  }

  return needsRetry;
}

export async function recordRenewalCommission(
  invoice: InvoiceWithLegacySubscription,
  subscriptionId: string
): Promise<boolean> {
  const { data: referral, error: referralError } = await supabaseAdmin
    .from("referrals")
    .select("id, affiliate_id, affiliates(commission_rate, status)")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (referralError) {
    console.error("Affiliate renewal referral lookup failed", referralError);
    return true;
  }
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

  const { data: commission, error } = await supabaseAdmin.rpc("record_affiliate_commission", {
    p_affiliate_id: referral.affiliate_id,
    p_referral_id: referral.id,
    p_stripe_reference: invoiceId,
    p_gross_amount_cents: amountPaid,
    p_currency: invoice.currency ?? "usd",
    p_commission_rate: rate,
  });
  if (error) {
    console.error("Affiliate renewal commission transaction failed", error);
    return true;
  }
  if (commission?.inserted) {
    console.info("Affiliate renewal commission recorded", {
      affiliateId: referral.affiliate_id,
      invoiceId,
      amountCents: commission.amount_cents,
      status: commission.status,
    });
  }
  return false;
}

export async function reconcileAffiliateCommissions(
  references: Array<string | null | undefined>,
  netAmountCents: number,
  reason: string
): Promise<boolean> {
  const ids = [...new Set(references.filter((value): value is string => Boolean(value)))];
  if (ids.length === 0) return false;

  const { data: result, error } = await supabaseAdmin.rpc("reconcile_affiliate_commissions", {
    p_stripe_references: ids,
    p_net_amount_cents: Math.max(0, Math.round(netAmountCents)),
    p_reason: reason,
  });
  if (error) {
    console.error("Commission reconciliation failed", error);
    return true;
  }
  if ((result?.voided ?? 0) > 0 || (result?.adjusted ?? 0) > 0) {
    console.info("Affiliate commissions reconciled", {
      voided: result?.voided ?? 0,
      adjusted: result?.adjusted ?? 0,
      reason,
      references: ids,
    });
  }
  if ((result?.paid_requires_review ?? 0) > 0) {
    console.warn("Manual paid affiliate commission clawback required", {
      count: result.paid_requires_review,
      reason,
      references: ids,
    });
  }
  return false;
}
