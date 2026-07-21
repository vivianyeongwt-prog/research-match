import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { authenticatedUser, customerIdsForUser } from "@/lib/stripe-customers";
import { allowRequestRate } from "@/lib/server-access";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

function isCancelableSubscription(subscription: Stripe.Subscription) {
  return ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(subscription.status);
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "You must be signed in to cancel a subscription." }, { status: 401 });
    }
    if (!(await allowRequestRate(req, "cancel-subscription", 4, user.id, 600))) {
      return NextResponse.json({ error: "Too many cancellation attempts." }, { status: 429 });
    }

    const customerIds = await customerIdsForUser(stripe, user.id, user.email);
    if (customerIds.length === 0) {
      return NextResponse.json(
        { error: "No Stripe customer found for this user. Contact support." },
        { status: 404 }
      );
    }

    const cancelableSubscriptions: Stripe.Subscription[] = [];

    for (const customer of customerIds) {
      const subscriptions = await stripe.subscriptions.list({
        customer,
        status: "all",
        limit: 100,
      });

      for (const subscription of subscriptions.data) {
        if (!isCancelableSubscription(subscription)) continue;
        cancelableSubscriptions.push(subscription);
      }
    }

    if (cancelableSubscriptions.length === 0) {
      return NextResponse.json(
        { error: "No active subscription found for this user." },
        { status: 404 }
      );
    }

    const scheduled: string[] = [];
    for (const subscription of cancelableSubscriptions) {
      // Cancel at period end so the user keeps the access they already paid for. The
      // webhook downgrades to free when the subscription actually ends
      // (customer.subscription.deleted at period end), not now.
      const updated = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });
      scheduled.push(updated.id);
    }

    return NextResponse.json({ canceled: scheduled, scheduledCancel: true });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    return NextResponse.json(
      { error: "Could not cancel your subscription right now. Please try again or contact support." },
      { status: 500 }
    );
  }
}
