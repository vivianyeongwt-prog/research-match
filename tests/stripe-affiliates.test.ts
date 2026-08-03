import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server-access", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

type QueryResult = {
  data: unknown;
  error: null | { code?: string; message: string };
};

function terminalQuery(method: "maybeSingle" | "single", result: QueryResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "insert"]) {
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
    discounts: [{ promotion_code: "promo_creator" }],
  } as unknown as Stripe.Checkout.Session;
}

describe("affiliate attribution retry safety", () => {
  let recordAffiliateAttribution: typeof import("../src/lib/stripe-affiliates").recordAffiliateAttribution;
  let recordRenewalCommission: typeof import("../src/lib/stripe-affiliates").recordRenewalCommission;
  let reconcileAffiliateCommissions: typeof import("../src/lib/stripe-affiliates").reconcileAffiliateCommissions;

  beforeAll(async () => {
    ({ recordAffiliateAttribution, recordRenewalCommission, reconcileAffiliateCommissions } =
      await import("../src/lib/stripe-affiliates"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on an affiliate database outage so the Stripe event is retried", async () => {
    mocks.from.mockReturnValueOnce(
      terminalQuery("maybeSingle", {
        data: null,
        error: { message: "database unavailable" },
      })
    );

    await expect(recordAffiliateAttribution(checkoutSession())).rejects.toThrow(
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
    mocks.from.mockReturnValueOnce(affiliateQuery).mockReturnValueOnce(referralQuery);
    mocks.rpc.mockResolvedValueOnce({
      data: { inserted: true, amount_cents: 240, status: "pending" },
      error: null,
    });

    await expect(recordAffiliateAttribution(checkoutSession())).resolves.toBe(false);
    expect(referralQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_checkout_session_id: "cs_affiliate_once",
        stripe_subscription_id: null,
      })
    );
    expect(mocks.rpc).toHaveBeenCalledWith("record_affiliate_commission", {
      p_affiliate_id: "affiliate-1",
      p_referral_id: "referral-1",
      p_stripe_reference: "pi_test",
      p_gross_amount_cents: 800,
      p_currency: "usd",
      p_commission_rate: 0.3,
    });
  });

  it("recovers a first-touch customer uniqueness conflict for the same affiliate", async () => {
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
      data: null,
      error: { code: "23505", message: "duplicate customer" },
    });
    const sessionLookup = terminalQuery("maybeSingle", {
      data: null,
      error: null,
    });
    const customerLookup = terminalQuery("maybeSingle", {
      data: { id: "referral-existing", affiliate_id: "affiliate-1" },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(affiliateQuery)
      .mockReturnValueOnce(referralQuery)
      .mockReturnValueOnce(sessionLookup)
      .mockReturnValueOnce(customerLookup);
    mocks.rpc.mockResolvedValueOnce({
      data: { inserted: true, amount_cents: 240, status: "pending" },
      error: null,
    });

    await expect(recordAffiliateAttribution(checkoutSession())).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_affiliate_commission",
      expect.objectContaining({ p_referral_id: "referral-existing" })
    );
  });

  it("preserves the original affiliate when a customer enters another affiliate code", async () => {
    const affiliateQuery = terminalQuery("maybeSingle", {
      data: {
        id: "affiliate-new",
        commission_rate: 0.3,
        status: "active",
        email: "creator@example.com",
      },
      error: null,
    });
    const referralQuery = terminalQuery("single", {
      data: null,
      error: { code: "23505", message: "duplicate customer" },
    });
    const sessionLookup = terminalQuery("maybeSingle", {
      data: null,
      error: null,
    });
    const customerLookup = terminalQuery("maybeSingle", {
      data: { id: "referral-existing", affiliate_id: "affiliate-original" },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(affiliateQuery)
      .mockReturnValueOnce(referralQuery)
      .mockReturnValueOnce(sessionLookup)
      .mockReturnValueOnce(customerLookup);

    await expect(recordAffiliateAttribution(checkoutSession())).resolves.toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requests a webhook retry when renewal attribution cannot be read", async () => {
    mocks.from.mockReturnValueOnce(
      terminalQuery("maybeSingle", {
        data: null,
        error: { message: "temporary read failure" },
      })
    );

    await expect(
      recordRenewalCommission(
        { id: "in_test", amount_paid: 700, currency: "usd" } as never,
        "sub_test"
      )
    ).resolves.toBe(true);
  });

  it("records renewal commission through the atomic RPC", async () => {
    mocks.from.mockReturnValueOnce(
      terminalQuery("maybeSingle", {
        data: {
          id: "referral-1",
          affiliate_id: "affiliate-1",
          affiliates: { commission_rate: 0.3, status: "active" },
        },
        error: null,
      })
    );
    mocks.rpc.mockResolvedValueOnce({
      data: { inserted: true, amount_cents: 210, status: "pending" },
      error: null,
    });

    await expect(
      recordRenewalCommission(
        { id: "in_renewal", amount_paid: 700, currency: "usd" } as never,
        "sub_test"
      )
    ).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("record_affiliate_commission", {
      p_affiliate_id: "affiliate-1",
      p_referral_id: "referral-1",
      p_stripe_reference: "in_renewal",
      p_gross_amount_cents: 700,
      p_currency: "usd",
      p_commission_rate: 0.3,
    });
  });

  it("deduplicates references and records partial-refund net revenue", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { voided: 0, adjusted: 1, paid_requires_review: 0 },
      error: null,
    });

    await expect(
      reconcileAffiliateCommissions(["in_test", "pi_test", "in_test", null], 400, "refund")
    ).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("reconcile_affiliate_commissions", {
      p_stripe_references: ["in_test", "pi_test"],
      p_net_amount_cents: 400,
      p_reason: "refund",
    });
  });
});
