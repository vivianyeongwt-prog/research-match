import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/server-access", () => ({
  supabaseAdmin: { from: mocks.from },
}));

type QueryResult = { data: unknown; error: null | { code?: string; message: string } };

function terminalQuery(method: "maybeSingle" | "single", result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "upsert"]) {
    query[name] = vi.fn(() => query);
  }
  query[method] = vi.fn(async () => result);
  return query;
}

function checkoutSession(): Stripe.Checkout.Session {
  return {
    id: "cs_affiliate_once",
    customer: "cus_test",
    subscription: null,
    payment_intent: "pi_test",
    invoice: null,
    amount_total: 800,
    currency: "usd",
    customer_email: "buyer@example.com",
  } as unknown as Stripe.Checkout.Session;
}

describe("affiliate attribution retry safety", () => {
  let recordAffiliateAttribution: typeof import("../src/lib/stripe-affiliates").recordAffiliateAttribution;
  let recordRenewalCommission: typeof import("../src/lib/stripe-affiliates").recordRenewalCommission;

  beforeAll(async () => {
    ({ recordAffiliateAttribution, recordRenewalCommission } = await import(
      "../src/lib/stripe-affiliates"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on an affiliate database outage so the Stripe event is retried", async () => {
    mocks.from.mockReturnValueOnce(
      terminalQuery("maybeSingle", { data: null, error: { message: "database unavailable" } })
    );
    const stripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => ({ discounts: [{ promotion_code: "promo_creator" }] })),
        },
      },
    } as unknown as Stripe;

    await expect(recordAffiliateAttribution(stripe, checkoutSession())).rejects.toThrow(
      "Affiliate lookup failed"
    );
  });

  it("keys one-time referral rows by Checkout Session so webhook retries cannot add counts", async () => {
    const affiliateQuery = terminalQuery("maybeSingle", {
      data: {
        id: "affiliate-1",
        commission_rate: 0.3,
        status: "active",
        email: "creator@example.com",
      },
      error: null,
    });
    const referralQuery = terminalQuery("single", {
      data: { id: "referral-1" },
      error: null,
    });
    const commissionLookup = terminalQuery("maybeSingle", { data: null, error: null });
    const commissionInsert = { insert: vi.fn(async () => ({ error: null })) };
    mocks.from
      .mockReturnValueOnce(affiliateQuery)
      .mockReturnValueOnce(referralQuery)
      .mockReturnValueOnce(commissionLookup)
      .mockReturnValueOnce(commissionInsert);

    const stripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn(async () => ({ discounts: [{ promotion_code: "promo_creator" }] })),
        },
      },
    } as unknown as Stripe;

    await expect(recordAffiliateAttribution(stripe, checkoutSession())).resolves.toBe(false);
    expect(referralQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_checkout_session_id: "cs_affiliate_once",
        stripe_subscription_id: null,
      }),
      { onConflict: "stripe_checkout_session_id" }
    );
  });

  it("requests a webhook retry when renewal attribution cannot be read", async () => {
    mocks.from.mockReturnValueOnce(
      terminalQuery("maybeSingle", { data: null, error: { message: "temporary read failure" } })
    );

    await expect(
      recordRenewalCommission(
        { id: "in_test", amount_paid: 700, currency: "usd" } as never,
        "sub_test"
      )
    ).resolves.toBe(true);
  });
});
