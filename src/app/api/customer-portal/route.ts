import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { authenticatedUser, customerIdsForUser } from "@/lib/stripe-customers";
import { siteOrigin } from "@/lib/site-url";
import { allowRequestRate } from "@/lib/server-access";
import { stripeClient } from "@/lib/stripe-server";
import { isPortalSubscription } from "@/lib/stripe-subscriptions";

async function customerWithCurrentSubscription(stripe: Stripe, customerIds: string[]) {
  for (const customer of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });

    const hasCurrentSubscription = subscriptions.data.some(isPortalSubscription);

    if (hasCurrentSubscription) return customer;
  }

  return customerIds[0];
}

// Opens a billing portal session. If no Customer Portal configuration has been
// saved yet (the classic "customers can't cancel" cause — Stripe throws until
// you save portal settings once in the Dashboard), create a sensible default
// with cancellation enabled and retry. The first config created becomes the
// account default, so this self-heals after one call.
async function createPortalSession(stripe: Stripe, customer: string, returnUrl: string) {
  try {
    return await stripe.billingPortal.sessions.create({ customer, return_url: returnUrl });
  } catch (err) {
    const missingConfig =
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      /configuration/i.test(err.message || "");
    if (!missingConfig) throw err;

    const config = await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Manage your Research Match subscription" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true },
      },
    });
    return await stripe.billingPortal.sessions.create({
      customer,
      configuration: config.id,
      return_url: returnUrl,
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const stripe = stripeClient();
    const user = await authenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "You must be signed in to manage billing." }, { status: 401 });
    }
    if (!(await allowRequestRate(req, "customer-portal", 8, user.id, 600))) {
      return NextResponse.json({ error: "Too many billing requests." }, { status: 429 });
    }

    const customerIds = await customerIdsForUser(stripe, user.id, user.email);

    if (customerIds.length === 0) {
      return NextResponse.json(
        { error: "No Stripe customer found for this user. Contact support." },
        { status: 404 }
      );
    }

    const customer = await customerWithCurrentSubscription(stripe, customerIds);

    const portalSession = await createPortalSession(stripe, customer, `${siteOrigin()}/profile`);

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Customer portal error:", err);
    return NextResponse.json({ error: "Could not open the billing portal. Please try again or contact support." }, { status: 500 });
  }
}
