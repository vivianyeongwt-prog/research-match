import type Stripe from "stripe";

const CURRENT_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
]);

const PORTAL_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
]);

export function isCurrentSubscription(subscription: Pick<Stripe.Subscription, "status">) {
  return CURRENT_SUBSCRIPTION_STATUSES.has(subscription.status);
}

export function isPortalSubscription(
  subscription: Pick<Stripe.Subscription, "status" | "cancel_at_period_end">
) {
  return (
    PORTAL_SUBSCRIPTION_STATUSES.has(subscription.status) &&
    !subscription.cancel_at_period_end
  );
}
