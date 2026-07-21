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
