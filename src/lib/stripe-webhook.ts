import type Stripe from "stripe";

export type InvoiceWithLegacySubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

export function stripeId(
  reference: string | { id?: string } | null | undefined
): string | null {
  if (!reference) return null;
  return typeof reference === "string" ? reference : reference.id ?? null;
}

export function subscriptionIdFromInvoice(
  invoice: InvoiceWithLegacySubscription
): string | null {
  return (
    stripeId(invoice.subscription) ??
    stripeId(
      invoice.parent?.type === "subscription_details"
        ? invoice.parent.subscription_details?.subscription
        : null
    )
  );
}

/** Resolve invoices connected to a PaymentIntent on current Stripe API versions. */
export async function invoiceRefsForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string | null | undefined
): Promise<string[]> {
  if (!paymentIntentId) return [];
  const list = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 10,
  });
  return list.data
    .map((payment) => stripeId(payment.invoice))
    .filter((id): id is string => Boolean(id));
}

/** Resolve the Checkout Session that originally created a refunded/disputed payment. */
export async function checkoutSessionIdsForPaymentRefs(
  stripe: Stripe,
  paymentIntentId: string | null | undefined,
  invoiceIds: string[]
): Promise<string[]> {
  const sessionIds = new Set<string>();
  const invoiceIdSet = new Set(invoiceIds);

  if (paymentIntentId) {
    const directSessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 100,
    });
    for (const session of directSessions.data) sessionIds.add(session.id);
  }

  for (const invoiceId of invoiceIdSet) {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (!subscriptionId) continue;
    const subscriptionSessions = await stripe.checkout.sessions.list({
      subscription: subscriptionId,
      limit: 100,
    });
    for (const session of subscriptionSessions.data) {
      // Only the initial Checkout invoice earned the Buddy reward. Refunding a
      // later renewal on the same subscription must not void that original reward.
      const sessionInvoiceId = stripeId(session.invoice);
      if (sessionInvoiceId && invoiceIdSet.has(sessionInvoiceId)) {
        sessionIds.add(session.id);
      }
    }
  }

  return [...sessionIds];
}
