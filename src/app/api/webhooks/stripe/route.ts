import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { generateReferralCode } from "@/lib/buddy-pass";
import { supabaseAdmin } from "@/lib/server-access";
import { paidPlanFromPriceId, type PaidPlanType, verifiedUserId } from "@/lib/stripe-plans";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

function stripeId(ref: string | { id?: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

// Stripe moved the subscription reference under `parent.subscription_details`
// in newer API versions. Keep the optional legacy property so delayed events
// created on an older API version can still be handled safely.
type InvoiceWithLegacySubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

function subscriptionIdFromInvoice(invoice: InvoiceWithLegacySubscription): string | null {
  return stripeId(invoice.subscription) ?? stripeId(
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : null
  );
}

// ── Affiliate attribution ─────────────────────────────────────────────────────
// Records the first-payment commission for a creator whose promo code was used at
// checkout. Returns `true` if a transient DB failure means the event should be
// retried (so the caller leaves the event un-marked). Throwing is avoided so plan
// provisioning still runs; money-write failures are signalled via the return value.
async function recordAffiliateAttribution(session: Stripe.Checkout.Session): Promise<boolean> {
  let needsRetry = false;

  // The applied promotion code is what identifies the creator. Re-fetch with the
  // discounts expanded — the raw webhook session may not include them.
  const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["discounts"],
  });
  const promotionCodeId =
    (fullSession.discounts ?? [])
      .map((d) =>
        typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code?.id ?? null
      )
      .find(Boolean) ?? null;
  if (!promotionCodeId) return false;

  const { data: affiliate } = await supabaseAdmin
    .from("affiliates")
    .select("id, commission_rate, status, email")
    .eq("stripe_promotion_code_id", promotionCodeId)
    .maybeSingle();
  if (!affiliate || (affiliate.status ?? "active") !== "active") return false;

  // Self-referral guard: a creator can't earn commission on their own purchase.
  const buyerEmail = (session.customer_details?.email || session.customer_email || "")
    .trim()
    .toLowerCase();
  const affiliateEmail = (affiliate.email || "").trim().toLowerCase();
  if (buyerEmail && affiliateEmail && buyerEmail === affiliateEmail) {
    console.warn(`⛔ Affiliate self-referral blocked for ${affiliateEmail}`);
    return false;
  }

  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);

  // One referral per subscription (idempotent upsert). One-time payments have no
  // subscription and no renewals, so a plain insert is fine there.
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
      console.error("Affiliate referral upsert failed:", error);
      needsRetry = true;
    }
    referralId = data?.id ?? null;
  } else {
    const { data, error } = await supabaseAdmin
      .from("referrals")
      .insert({ affiliate_id: affiliate.id, stripe_customer_id: customerId, stripe_subscription_id: null })
      .select("id")
      .single();
    if (error) {
      console.error("Affiliate referral insert failed:", error);
      needsRetry = true;
    }
    referralId = data?.id ?? null;
  }

  // First-payment commission, on what the customer actually paid (net of discount),
  // deduped by invoice/payment ref so a retry or the first invoice.paid can't double it.
  const invoiceRef = stripeId(session.invoice) ?? stripeId(session.payment_intent) ?? session.id;
  const amountTotal = session.amount_total ?? 0;
  const rate = Number(affiliate.commission_rate ?? 0.3);

  if (referralId && amountTotal > 0 && rate > 0) {
    const { data: existing } = await supabaseAdmin
      .from("commissions")
      .select("id")
      .eq("stripe_invoice_id", invoiceRef)
      .maybeSingle();
    if (!existing) {
      const amountCents = Math.round(amountTotal * rate);
      const { error } = await supabaseAdmin.from("commissions").insert({
        affiliate_id: affiliate.id,
        referral_id: referralId,
        stripe_invoice_id: invoiceRef,
        amount_cents: amountCents,
        currency: session.currency ?? "usd",
        status: "pending",
      });
      // 23505 = a concurrent delivery already recorded it → success, not a failure.
      if (error && error.code !== "23505") {
        console.error("Affiliate commission insert failed:", error);
        needsRetry = true;
      } else if (!error) {
        console.log(`💸 Affiliate first-payment commission: affiliate=${affiliate.id} amount_cents=${amountCents}`);
      }
    }
  }

  return needsRetry;
}

// Recurring commission on a renewal payment. Returns true if it should be retried.
async function recordRenewalCommission(invoice: InvoiceWithLegacySubscription, subscriptionId: string): Promise<boolean> {
  let needsRetry = false;
  const { data: referral } = await supabaseAdmin
    .from("referrals")
    .select("id, affiliate_id, affiliates(commission_rate, status)")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  const affiliateRow = Array.isArray(referral?.affiliates)
    ? referral?.affiliates[0]
    : referral?.affiliates;
  if (!referral || !affiliateRow || (affiliateRow.status ?? "active") !== "active") return false;

  const invoiceId: string | null = invoice.id ?? null;
  const amountPaid: number = invoice.amount_paid ?? 0;
  const rate = Number(affiliateRow.commission_rate ?? 0.3);
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
    console.error("Affiliate renewal commission insert failed:", error);
    needsRetry = true;
  } else if (!error) {
    console.log(`💸 Affiliate renewal commission: affiliate=${referral.affiliate_id} invoice=${invoiceId} amount_cents=${amountCents}`);
  }
  return needsRetry;
}

// Void any pending commissions tied to a reversed payment (refund or lost dispute),
// so the creator is never paid on money the business gave back. Returns true if the
// void FAILED transiently (caller should set needsRetry so Stripe redelivers — without
// this, a failed void would be acked and the creator stays paid on reversed money).
async function voidCommissionsForRefs(refs: (string | null | undefined)[], reason: string): Promise<boolean> {
  const ids = [...new Set(refs.filter((r): r is string => !!r))];
  if (ids.length === 0) return false;
  const { data: voided, error } = await supabaseAdmin
    .from("commissions")
    .update({ status: "void" })
    .in("stripe_invoice_id", ids)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("Commission void failed:", error);
    return true;
  }
  if (voided && voided.length > 0) {
    console.log(`↩️  Voided ${voided.length} commission(s) (${reason}) for ${ids.join(", ")}`);
  }
  // Already-paid commissions can't be auto-reclaimed — flag for manual clawback.
  const { data: paid } = await supabaseAdmin
    .from("commissions")
    .select("id, amount_cents, affiliate_id")
    .in("stripe_invoice_id", ids)
    .eq("status", "paid");
  for (const p of paid ?? []) {
    console.warn(`⚠️  MANUAL CLAWBACK: paid commission ${p.id} (affiliate ${p.affiliate_id}, ${p.amount_cents}c) was reversed (${reason}).`);
  }
  return false;
}

// Map a refunded/disputed payment_intent back to its invoice id(s). Subscription
// commissions are keyed on the invoice id (in_…), and on API 2026-02-25.clover a
// Charge/PaymentIntent no longer exposes `invoice` directly — the link lives on
// InvoicePayment, so we resolve it there.
async function invoiceRefsForPaymentIntent(pi: string | null | undefined): Promise<string[]> {
  if (!pi) return [];
  try {
    const list = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: pi },
      limit: 10,
    });
    return list.data.map((p) => stripeId(p.invoice)).filter((id): id is string => !!id);
  } catch (err) {
    console.error("invoicePayments lookup failed:", err);
    return [];
  }
}

async function provisionPlan(userId: string, planType: PaidPlanType) {
  const updateExisting = async () => {
    let query = supabaseAdmin.from("profiles").update({ plan_type: planType, plan_expires_at: null }).eq("id", userId);
    if (planType !== "lifetime") query = query.neq("plan_type", "lifetime");
    return query.select("id, plan_type");
  };

  let result = await updateExisting();
  if (result.error) return { error: result.error, keptLifetime: false };
  if (result.data && result.data.length > 0) return { error: null, keptLifetime: false };

  const { data: current, error: currentError } = await supabaseAdmin
    .from("profiles")
    .select("plan_type")
    .eq("id", userId)
    .maybeSingle();
  if (currentError) return { error: currentError, keptLifetime: false };
  if (current?.plan_type === "lifetime" && planType !== "lifetime") {
    return { error: null, keptLifetime: true };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError || !authData.user) {
    return { error: authError ?? new Error("Auth user not found"), keptLifetime: false };
  }
  const { error: insertError } = await supabaseAdmin.from("profiles").insert({
    id: userId,
    email: authData.user.email ?? "",
    plan_type: "free",
    referral_code: generateReferralCode(userId),
  });
  if (insertError && insertError.code !== "23505") {
    return { error: insertError, keptLifetime: false };
  }

  result = await updateExisting();
  if (result.error || !result.data || result.data.length === 0) {
    return { error: result.error ?? new Error("Profile could not be provisioned"), keptLifetime: false };
  }
  return { error: null, keptLifetime: false };
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Claim first, but do not call the event complete until every side effect has
  // succeeded. A failed handler is retryable immediately; a process crash leaves a
  // time-bounded claim that a later Stripe delivery can recover.
  const { data: claimState, error: guardError } = await supabaseAdmin
    .rpc("claim_stripe_event", { p_event_id: event.id });
  if (claimState === "completed") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (guardError || claimState !== "claimed") {
    console.error("Idempotency guard insert error:", guardError);
    return NextResponse.json({ error: "transient failure, please retry" }, { status: 500 });
  }

  let needsRetry = false;

  // All processing runs under one try/catch: an uncaught error (e.g. a transient
  // Stripe API failure mid-handler) must flow into the needsRetry path below. If it
  // escaped instead, the guard row would stay behind, Stripe's redelivery would be
  // acked as a duplicate, and the event would be dropped forever.
  try {

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      let planType: PaidPlanType | null = null;
      let paidPriceIdForReferral: string | null = null;

      if (session.mode === "payment") {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const paidPriceId = lineItems.data[0]?.price?.id;
        paidPriceIdForReferral = paidPriceId ?? null;
        planType = paidPlanFromPriceId(paidPriceId);
      } else if (session.mode === "subscription" && session.subscription) {
        const subscriptionId = stripeId(session.subscription);
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price.id;
          paidPriceIdForReferral = priceId ?? null;
          planType = paidPlanFromPriceId(priceId);
        }
      }

      // (A) Affiliate attribution — runs regardless of our profile bookkeeping. The
      // customer paid and the creator earned even if our profiles row never resolves,
      // so this must not be coupled to the plan-provisioning success/failure below.
      try {
        needsRetry = (await recordAffiliateAttribution(session)) || needsRetry;
      } catch (err) {
        // e.g. a transient Stripe failure re-fetching the session — redeliver rather
        // than silently losing the creator's commission.
        console.error("Affiliate attribution error:", err);
        needsRetry = true;
      }

      // (B) Provision the plan. A missing profile is repaired from the verified auth
      // user, and every unresolved write remains retryable until Stripe redelivers it.
      const userId = verifiedUserId(session.metadata?.userId) ?? verifiedUserId(session.client_reference_id);
      if (!userId) {
        // An unrelated Stripe checkout can share this webhook endpoint. Without a
        // verified Research Match user ID, acknowledge it after any affiliate work
        // rather than touching an account or retrying forever.
        console.warn("checkout.session.completed has no verified Research Match user ID — access unchanged");
      } else if (!planType) {
        // A checkout carrying our user ID but an unknown price is most likely an
        // environment/legacy-price omission. Fail closed and leave it retryable.
        console.error(`No access plan is configured for Stripe price ${paidPriceIdForReferral ?? "unknown"}`);
        needsRetry = true;
      } else {
        const provisioned = await provisionPlan(userId, planType);

        if (provisioned.error) {
          console.error("Plan provisioning error:", provisioned.error);
          needsRetry = true;
        } else {
          console.log(provisioned.keptLifetime
            ? `↔️  Kept lifetime access for userId: ${userId}`
            : `✅ Plan updated to "${planType}" for userId: ${userId}`);

          // Lifetime replaces an existing subscription. Cancel it immediately so
          // the customer cannot be charged again after buying permanent access.
          if (planType === "lifetime") {
            try {
              const subscriptions = await stripe.subscriptions.search({
                query: `metadata['userId']:'${userId.replace(/'/g, "\\'")}'`,
                limit: 100,
              });
              for (const subscription of subscriptions.data) {
                if (["active", "trialing", "past_due", "unpaid", "incomplete"].includes(subscription.status)) {
                  await stripe.subscriptions.cancel(subscription.id);
                }
              }
            } catch (err) {
              console.error("Could not cancel replaced subscription after lifetime purchase:", err);
              needsRetry = true;
            }
          }

          // Buddy Pass referral reward (peer-to-peer; separate from the affiliate program).
          if (
            verifiedUserId(session.metadata?.referrerId) &&
            session.metadata?.referralCode &&
            session.metadata?.referredUserId === userId &&
            session.metadata.referrerId !== userId
          ) {
            try {
              const referrerId = verifiedUserId(session.metadata.referrerId)!;
              const { data: granted, error: rewardError } = await supabaseAdmin.rpc("record_buddy_pass_reward", {
                p_referrer_id: referrerId,
                p_referred_user_id: userId,
                p_referral_code: session.metadata.referralCode,
                p_checkout_session_id: session.id,
                p_stripe_customer_id: stripeId(session.customer),
                p_price_id: paidPriceIdForReferral,
              });
              if (rewardError) {
                console.error("Buddy Pass reward transaction failed:", rewardError);
                needsRetry = true;
              } else if (granted) {
                console.log(`✅ Buddy Pass reward granted to referrerId: ${referrerId}`);
              }
            } catch (err) {
              console.error("Buddy Pass reward error:", err);
              needsRetry = true;
            }
          }

        }
      }
    }

    // Helper: look up userId from subscription metadata first, then checkout metadata.
    async function userIdFromSubscription(subscriptionId: string): Promise<string | null> {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const metadataUserId = verifiedUserId(subscription.metadata?.userId);
      if (metadataUserId) return metadataUserId;
      const sessions = await stripe.checkout.sessions.list({
        subscription: subscriptionId,
        limit: 1,
      });
      return verifiedUserId(sessions.data[0]?.metadata?.userId) ??
        verifiedUserId(sessions.data[0]?.client_reference_id);
    }

    // Downgrade a user when a subscription ends — but ONLY the plan this subscription
    // granted. A lifetime purchase, or a promo-granted semester, must survive an old
    // weekly sub expiring. Grant and downgrade both label the sub via
    // paidPlanFromPriceId, so exact-match is consistent for configured price ids.
    // The .eq guard makes it a single atomic statement, so there's no read/write race.
    async function downgradeToFree(userId: string, endedPlan: PaidPlanType, reason: string) {
      const { error, data } = await supabaseAdmin
        .from("profiles")
        .update({ plan_type: "free", plan_expires_at: null })
        .eq("id", userId)
        .eq("plan_type", endedPlan)
        .select("id");
      if (error) {
        console.error(`Downgrade failed (${reason}) for userId ${userId}:`, error);
        needsRetry = true;
      } else if (!data || data.length === 0) {
        console.log(`↔️  ${reason} for userId ${userId} — current plan isn't "${endedPlan}" (kept) or profile missing`);
      } else {
        console.log(`⬇️  ${reason} → downgraded userId: ${userId} to free`);
      }
    }

    async function revokeAccessForPaymentIntent(paymentIntentId: string | null, reason: string) {
      if (!paymentIntentId) return;
      const handledSubscriptions = new Set<string>();
      const handledPlans = new Set<string>();

      const sessions = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 10,
      });
      for (const session of sessions.data) {
        const userId = verifiedUserId(session.metadata?.userId) ?? verifiedUserId(session.client_reference_id);
        if (!userId) continue;
        if (session.subscription) {
          const subscriptionId = stripeId(session.subscription);
          if (!subscriptionId || handledSubscriptions.has(subscriptionId)) continue;
          handledSubscriptions.add(subscriptionId);
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
          if (!endedPlan) throw new Error(`Cannot revoke unrecognized subscription price for ${subscriptionId}`);
          if (subscription.status !== "canceled") await stripe.subscriptions.cancel(subscriptionId);
          await downgradeToFree(userId, endedPlan, reason);
        } else {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          const priceId = lineItems.data[0]?.price?.id;
          const endedPlan = paidPlanFromPriceId(priceId);
          if (!endedPlan) throw new Error(`Cannot revoke unrecognized checkout price for ${session.id}`);
          const key = `${userId}:${endedPlan}`;
          if (!handledPlans.has(key)) {
            handledPlans.add(key);
            await downgradeToFree(userId, endedPlan, reason);
          }
        }
      }

      for (const invoiceId of await invoiceRefsForPaymentIntent(paymentIntentId)) {
        // Stripe's current Invoice shape nests the subscription reference under
        // parent.subscription_details; retain the legacy property for older events.
        const invoice = await stripe.invoices.retrieve(invoiceId) as InvoiceWithLegacySubscription;
        const subscriptionId = subscriptionIdFromInvoice(invoice);
        if (!subscriptionId || handledSubscriptions.has(subscriptionId)) continue;
        handledSubscriptions.add(subscriptionId);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = await userIdFromSubscription(subscriptionId);
        const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
        if (userId && !endedPlan) throw new Error(`Cannot revoke unrecognized subscription price for ${subscriptionId}`);
        if (subscription.status !== "canceled") await stripe.subscriptions.cancel(subscriptionId);
        if (userId && endedPlan) await downgradeToFree(userId, endedPlan, reason);
      }
    }

    // Subscription deleted (cancelled / reached end of billing period)
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await userIdFromSubscription(sub.id);
      if (userId) {
        const endedPlan = paidPlanFromPriceId(sub.items?.data?.[0]?.price?.id);
        if (!endedPlan) throw new Error(`Unrecognized deleted subscription price for ${sub.id}`);
        await downgradeToFree(userId, endedPlan, "Subscription deleted");
      }
    }

    // Subscription updated — downgrade only on TERMINAL states (keep access through the
    // past_due dunning window), and catch cancel_at_period_end being newly set.
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const downgradeStatuses = ["unpaid", "canceled", "incomplete_expired"];

      // Only downgrade on TERMINAL statuses. A scheduled cancel (cancel_at_period_end)
      // keeps the subscription active and paid through the current period — do NOT strip
      // access then; the downgrade happens at period end via customer.subscription.deleted.
      // (This also means reactivating before period end keeps access, since it was never
      // downgraded.)
      if (downgradeStatuses.includes(sub.status)) {
        const userId = await userIdFromSubscription(sub.id);
        if (userId) {
          const endedPlan = paidPlanFromPriceId(sub.items?.data?.[0]?.price?.id);
          if (!endedPlan) throw new Error(`Unrecognized updated subscription price for ${sub.id}`);
          await downgradeToFree(userId, endedPlan, `Subscription status "${sub.status}"`);
        }
      }
    }

    // Invoice payment succeeded — re-grant plan on renewal + record the recurring
    // affiliate commission for this cycle.
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as InvoiceWithLegacySubscription;
      if (invoice.billing_reason === "subscription_cycle") {
        const subscriptionId = subscriptionIdFromInvoice(invoice);
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          if (!sub.cancel_at_period_end) {
            const userId = await userIdFromSubscription(subscriptionId);
            if (userId) {
              const priceId = sub.items.data[0]?.price.id;
              const planType = paidPlanFromPriceId(priceId);
              if (!planType) throw new Error(`Unrecognized renewal price for ${subscriptionId}`);
              // A renewal must never lower the plan: a weekly renewal can't overwrite
              // a (promo-granted) semester or a lifetime; a semester renewal can't
              // overwrite a lifetime.
              const outranking = planType === "weekly" ? '("lifetime","semester")' : '("lifetime")';
              const { error: renewError } = await supabaseAdmin
                .from("profiles")
                .update({ plan_type: planType, plan_expires_at: null })
                .eq("id", userId)
                .not("plan_type", "in", outranking);
              if (renewError) {
                console.error(`Renewal re-grant failed for userId ${userId}:`, renewError);
                needsRetry = true;
              } else {
                console.log(`🔄  Renewal succeeded → kept userId: ${userId} on "${planType}"`);
              }
            }
          }

          // Recurring commission — independent of cancel state (the payment was made).
          try {
            needsRetry = (await recordRenewalCommission(invoice, subscriptionId)) || needsRetry;
          } catch (err) {
            console.error("Affiliate renewal commission error:", err);
            needsRetry = true;
          }
        }
      }
    }

    // Invoice payment failed — keep access through the grace window; just log.
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as InvoiceWithLegacySubscription;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (subscriptionId) {
        const userId = await userIdFromSubscription(subscriptionId);
        console.log(`⏳  Payment failed (grace period — access kept) userId: ${userId ?? "unknown"} sub: ${subscriptionId}`);
      }
    }

    // Refund — void the commission so the creator isn't paid on returned money. Only
    // act on a FULL refund; partial refunds are left for manual review.
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge & { invoice?: string | Stripe.Invoice | null };
      if (charge.amount_refunded >= charge.amount) {
        const pi = stripeId(charge.payment_intent);
        // payment_intent covers one-time commissions; resolve the invoice id for
        // subscription commissions (charge.invoice is not populated on this API version).
        const refs = [stripeId(charge.invoice), pi, ...(await invoiceRefsForPaymentIntent(pi))];
        needsRetry = (await voidCommissionsForRefs(refs, "refund")) || needsRetry;
        await revokeAccessForPaymentIntent(pi, "Full refund");
      }
    }

    // Chargeback opened — the business will likely lose the funds; void the commission.
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const pi = stripeId(dispute.payment_intent);
      const refs: (string | null)[] = [pi, ...(await invoiceRefsForPaymentIntent(pi))];
      const chargeId = stripeId(dispute.charge);
      if (chargeId) {
        try {
          const charge = (await stripe.charges.retrieve(chargeId)) as Stripe.Charge & {
            invoice?: string | Stripe.Invoice | null;
          };
          const chPi = stripeId(charge.payment_intent);
          refs.push(stripeId(charge.invoice), chPi, ...(await invoiceRefsForPaymentIntent(chPi)));
        } catch (err) {
          console.error("Could not retrieve disputed charge:", err);
        }
      }
      needsRetry = (await voidCommissionsForRefs(refs, "dispute")) || needsRetry;
    }

  } catch (err) {
    console.error(`Unhandled webhook error for ${event.type} (${event.id}):`, err);
    needsRetry = true;
  }

  // Finalize. If a money-write failed transiently, un-mark the event and return 500
  // so Stripe redelivers; the idempotent retry re-records cleanly.
  if (needsRetry) {
    await supabaseAdmin
      .from("processed_stripe_events")
      .update({ status: "failed", last_error: `Handler failed for ${event.type}`, updated_at: new Date().toISOString() })
      .eq("id", event.id);
    return NextResponse.json({ error: "transient failure, please retry" }, { status: 500 });
  }

  const { data: completedEvent, error: completeError } = await supabaseAdmin
    .from("processed_stripe_events")
    .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", event.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (completeError || !completedEvent) {
    console.error(`Could not complete Stripe event ${event.id}:`, completeError);
    return NextResponse.json({ error: "transient failure, please retry" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
