import type Stripe from "stripe";
import { generateReferralCode } from "@/lib/buddy-pass";
import { supabaseAdmin } from "@/lib/server-access";
import { paidPlanFromPriceId, type PaidPlanType, verifiedUserId } from "@/lib/stripe-plans";
import {
  invoiceRefsForPaymentIntent,
  type InvoiceWithLegacySubscription,
  stripeId,
  subscriptionIdFromInvoice,
} from "@/lib/stripe-webhook";

export async function provisionPlan(userId: string, planType: PaidPlanType) {
  const updateExisting = async () => {
    let query = supabaseAdmin
      .from("profiles")
      .update({ plan_type: planType, plan_expires_at: null })
      .eq("id", userId);
    if (planType !== "lifetime") query = query.neq("plan_type", "lifetime");
    return query.select("id, plan_type");
  };

  let result = await updateExisting();
  if (result.error) return { error: result.error, keptLifetime: false };
  if (result.data && result.data.length > 0) {
    return { error: null, keptLifetime: false };
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from("profiles")
    .select("plan_type")
    .eq("id", userId)
    .maybeSingle();
  if (currentError) return { error: currentError, keptLifetime: false };
  if (current?.plan_type === "lifetime" && planType !== "lifetime") {
    return { error: null, keptLifetime: true };
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError || !authData.user) {
    return {
      error: authError ?? new Error("Auth user not found"),
      keptLifetime: false,
    };
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
    return {
      error: result.error ?? new Error("Profile could not be provisioned"),
      keptLifetime: false,
    };
  }
  return { error: null, keptLifetime: false };
}

export async function userIdFromSubscription(
  stripe: Stripe,
  subscriptionId: string
): Promise<string | null> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const metadataUserId = verifiedUserId(subscription.metadata?.userId);
  if (metadataUserId) return metadataUserId;
  const sessions = await stripe.checkout.sessions.list({
    subscription: subscriptionId,
    limit: 1,
  });
  return (
    verifiedUserId(sessions.data[0]?.metadata?.userId) ??
    verifiedUserId(sessions.data[0]?.client_reference_id)
  );
}

export async function downgradeToFree(
  userId: string,
  endedPlan: PaidPlanType,
  reason: string
): Promise<boolean> {
  const { error, data } = await supabaseAdmin
    .from("profiles")
    .update({ plan_type: "free", plan_expires_at: null })
    .eq("id", userId)
    .eq("plan_type", endedPlan)
    .select("id");
  if (error) {
    console.error("Subscription downgrade failed", { userId, endedPlan, reason, error });
    return true;
  }
  if (!data || data.length === 0) {
    console.info("Subscription ended without changing current access", {
      userId,
      endedPlan,
      reason,
    });
  } else {
    console.info("Subscription access downgraded to free", { userId, endedPlan, reason });
  }
  return false;
}

export async function revokeAccessForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string | null,
  reason: string
): Promise<boolean> {
  if (!paymentIntentId) return false;

  let needsRetry = false;
  const handledSubscriptions = new Set<string>();
  const handledPlans = new Set<string>();
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 10,
  });

  for (const session of sessions.data) {
    const userId =
      verifiedUserId(session.metadata?.userId) ??
      verifiedUserId(session.client_reference_id);
    if (!userId) continue;

    if (session.subscription) {
      const subscriptionId = stripeId(session.subscription);
      if (!subscriptionId || handledSubscriptions.has(subscriptionId)) continue;
      handledSubscriptions.add(subscriptionId);
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
      if (!endedPlan) {
        throw new Error(`Cannot revoke unrecognized subscription price for ${subscriptionId}`);
      }
      if (subscription.status !== "canceled") {
        await stripe.subscriptions.cancel(subscriptionId);
      }
      needsRetry = (await downgradeToFree(userId, endedPlan, reason)) || needsRetry;
      continue;
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const endedPlan = paidPlanFromPriceId(lineItems.data[0]?.price?.id);
    if (!endedPlan) {
      throw new Error(`Cannot revoke unrecognized checkout price for ${session.id}`);
    }
    const planKey = `${userId}:${endedPlan}`;
    if (!handledPlans.has(planKey)) {
      handledPlans.add(planKey);
      needsRetry = (await downgradeToFree(userId, endedPlan, reason)) || needsRetry;
    }
  }

  const invoiceIds = await invoiceRefsForPaymentIntent(stripe, paymentIntentId);
  for (const invoiceId of invoiceIds) {
    const invoice = (await stripe.invoices.retrieve(
      invoiceId
    )) as InvoiceWithLegacySubscription;
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (!subscriptionId || handledSubscriptions.has(subscriptionId)) continue;

    handledSubscriptions.add(subscriptionId);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = await userIdFromSubscription(stripe, subscriptionId);
    const endedPlan = paidPlanFromPriceId(subscription.items.data[0]?.price.id);
    if (userId && !endedPlan) {
      throw new Error(`Cannot revoke unrecognized subscription price for ${subscriptionId}`);
    }
    if (subscription.status !== "canceled") {
      await stripe.subscriptions.cancel(subscriptionId);
    }
    if (userId && endedPlan) {
      needsRetry = (await downgradeToFree(userId, endedPlan, reason)) || needsRetry;
    }
  }

  return needsRetry;
}
