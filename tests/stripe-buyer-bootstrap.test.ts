import { describe, expect, it, vi } from "vitest";
import {
  provisionBuyerStripe,
  RESEARCHMATCH_PRICE_SPECS,
  RESEARCHMATCH_WEBHOOK_EVENTS,
} from "../scripts/lib/stripe-buyer-bootstrap.mjs";

function fakeStripe() {
  const state = {
    products: [] as Array<Record<string, unknown>>,
    prices: [] as Array<Record<string, unknown>>,
    coupons: new Map<string, Record<string, unknown>>(),
    promotionCodes: [] as Array<Record<string, unknown>>,
    webhooks: [] as Array<Record<string, unknown>>,
  };
  const stripe = {
    accounts: {
      retrieve: vi.fn(async () => ({ id: "acct_buyer" })),
    },
    products: {
      list: vi.fn(async () => ({ data: state.products })),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const product = { id: "prod_researchmatch", active: true, ...params };
        state.products.push(product);
        return product;
      }),
    },
    prices: {
      list: vi.fn(async () => ({ data: state.prices })),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const price = {
          id: `price_${String((params.metadata as Record<string, string>).researchmatch_plan)}`,
          active: true,
          type: params.recurring ? "recurring" : "one_time",
          unit_amount: params.unit_amount,
          currency: params.currency,
          lookup_key: params.lookup_key,
          recurring: params.recurring ?? null,
          ...params,
        };
        state.prices.push(price);
        return price;
      }),
    },
    coupons: {
      retrieve: vi.fn(async (id: string) => {
        const coupon = state.coupons.get(id);
        if (!coupon) throw Object.assign(new Error("missing"), { code: "resource_missing" });
        return coupon;
      }),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const coupon = { valid: true, ...params };
        state.coupons.set(String(params.id), coupon);
        return coupon;
      }),
    },
    promotionCodes: {
      list: vi.fn(async () => ({ data: state.promotionCodes })),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const promotionCode = { id: "promo_oxford", active: true, ...params };
        state.promotionCodes.push(promotionCode);
        return promotionCode;
      }),
    },
    webhookEndpoints: {
      list: vi.fn(async () => ({ data: state.webhooks })),
      create: vi.fn(async (params: Record<string, unknown>) => {
        const webhook = {
          id: "we_researchmatch",
          status: "enabled",
          secret: "whsec_new",
          ...params,
        };
        state.webhooks.push(webhook);
        return webhook;
      }),
    },
  };
  return { state, stripe };
}

const baseEnvironment = {
  NEXT_PUBLIC_SITE_URL: "https://researchmatch.site",
  BUYER_STRIPE_ACCOUNT_ID: "acct_buyer",
};

describe("automatic buyer Stripe setup", () => {
  it("plans every missing resource without creating anything", async () => {
    const { stripe } = fakeStripe();
    const result = await provisionBuyerStripe(stripe, baseEnvironment);

    expect(result.actions).toHaveLength(8);
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.coupons.create).not.toHaveBeenCalled();
    expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
    expect(stripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });

  it("creates deterministic billing resources once and returns the complete env mapping", async () => {
    const { stripe } = fakeStripe();
    const first = await provisionBuyerStripe(stripe, baseEnvironment, { apply: true });

    expect(stripe.products.create).toHaveBeenCalledTimes(1);
    expect(stripe.prices.create).toHaveBeenCalledTimes(3);
    expect(stripe.coupons.create).toHaveBeenCalledTimes(2);
    expect(stripe.promotionCodes.create).toHaveBeenCalledTimes(1);
    expect(stripe.webhookEndpoints.create).toHaveBeenCalledTimes(1);
    expect(first.envUpdates).toMatchObject({
      NEXT_PUBLIC_STRIPE_PRICE_WEEKLY: "price_weekly",
      STRIPE_PRICE_WEEKLY: "price_weekly",
      NEXT_PUBLIC_STRIPE_PRICE_SEMESTER: "price_semester",
      STRIPE_PRICE_SEMESTER: "price_semester",
      NEXT_PUBLIC_STRIPE_PRICE_LIFETIME: "price_lifetime",
      STRIPE_PRICE_LIFETIME: "price_lifetime",
      STRIPE_BUDDY_PASS_COUPON_ID: "research_buddy_pass_25",
      STRIPE_AFFILIATE_COUPON_ID: "research_oxfordphd_20",
      STRIPE_WEBHOOK_SECRET: "whsec_new",
    });
    expect(stripe.webhookEndpoints.create).toHaveBeenCalledWith(
      expect.objectContaining({ enabled_events: RESEARCHMATCH_WEBHOOK_EVENTS }),
      expect.any(Object)
    );

    const second = await provisionBuyerStripe(
      stripe,
      { ...baseEnvironment, ...first.envUpdates },
      { apply: true }
    );
    expect(second.actions).toEqual([]);
    expect(stripe.products.create).toHaveBeenCalledTimes(1);
    expect(stripe.prices.create).toHaveBeenCalledTimes(3);
    expect(stripe.coupons.create).toHaveBeenCalledTimes(2);
    expect(stripe.promotionCodes.create).toHaveBeenCalledTimes(1);
    expect(stripe.webhookEndpoints.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed if a deterministic lookup key has the wrong price", async () => {
    const { state, stripe } = fakeStripe();
    const spec = RESEARCHMATCH_PRICE_SPECS[0];
    state.prices.push({
      id: "price_wrong",
      active: true,
      currency: "usd",
      unit_amount: 999,
      lookup_key: spec.lookupKey,
      type: "recurring",
      recurring: spec.recurring,
    });

    await expect(provisionBuyerStripe(stripe, baseEnvironment)).rejects.toThrow(
      "wrong price settings"
    );
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("fails closed before applying when the secret belongs to a different Stripe account", async () => {
    const { stripe } = fakeStripe();
    await expect(
      provisionBuyerStripe(
        stripe,
        { ...baseEnvironment, BUYER_STRIPE_ACCOUNT_ID: "acct_someone_else" },
        { apply: true }
      )
    ).rejects.toThrow("not the confirmed buyer account");
    expect(stripe.products.create).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.webhookEndpoints.create).not.toHaveBeenCalled();
  });
});
