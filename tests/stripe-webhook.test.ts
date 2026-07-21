import type Stripe from "stripe";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://research-match-tests.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

describe("Stripe webhook helpers", () => {
  it("reads both current and legacy invoice subscription references", async () => {
    const { subscriptionIdFromInvoice } = await import(
      "../src/lib/stripe-webhook"
    );
    const currentInvoice = {
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_current" },
      },
    } as unknown as Stripe.Invoice;
    const legacyInvoice = {
      subscription: "sub_legacy",
    } as unknown as Stripe.Invoice & { subscription: string };

    expect(subscriptionIdFromInvoice(currentInvoice)).toBe("sub_current");
    expect(subscriptionIdFromInvoice(legacyInvoice)).toBe("sub_legacy");
  });

  it("propagates invoice lookup failures so Stripe can retry financial cleanup", async () => {
    const { invoiceRefsForPaymentIntent } = await import(
      "../src/lib/stripe-webhook"
    );
    const stripe = {
      invoicePayments: {
        list: vi.fn().mockRejectedValue(new Error("temporary Stripe failure")),
      },
    } as unknown as Stripe;

    await expect(
      invoiceRefsForPaymentIntent(stripe, "pi_test")
    ).rejects.toThrow("temporary Stripe failure");
  });
});
