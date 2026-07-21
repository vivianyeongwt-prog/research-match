import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { authenticatedUser, customerIdsForUser } from "@/lib/stripe-customers";
import { allowRequestRate } from "@/lib/server-access";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

export async function GET(req: NextRequest) {
  try {
    const user = await authenticatedUser(req);
    if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    if (!(await allowRequestRate(req, "billing-status", 12, user.id))) {
      return NextResponse.json({ error: "Too many billing checks." }, { status: 429 });
    }

    const customerIds = await customerIdsForUser(stripe, user.id, user.email);
    for (const customer of customerIds) {
      const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
      const current = subscriptions.data.find((subscription) =>
        ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(subscription.status)
      );
      if (current) {
        return NextResponse.json({ hasSubscription: true, cancelAtPeriodEnd: current.cancel_at_period_end });
      }
    }
    return NextResponse.json({ hasSubscription: false, cancelAtPeriodEnd: false });
  } catch (err) {
    console.error("Billing status error:", err);
    return NextResponse.json({ error: "Could not verify billing status." }, { status: 500 });
  }
}
