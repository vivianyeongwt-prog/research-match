import { describe, expect, it } from "vitest";
import {
  STRIPE_INVENTORY_COLUMNS,
  classifySubscription,
  parseCsv,
  rowsToCsv,
  stripePricePlanMap,
  subscriptionInventoryRow,
} from "../scripts/lib/stripe-handoff.mjs";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_researchmatch",
    status: "active",
    customer: "cus_researchmatch",
    start_date: 1_700_000_000,
    cancel_at_period_end: false,
    collection_method: "charge_automatically",
    automatic_tax: { enabled: false },
    items: {
      data: [
        {
          price: { id: "price_weekly" },
          quantity: 1,
          current_period_end: 1_900_000_000,
        },
      ],
    },
    ...overrides,
  };
}

describe("Stripe handoff inventory", () => {
  it("selects only current ResearchMatch subscriptions", () => {
    const prices = stripePricePlanMap({
      STRIPE_PRICE_WEEKLY: "price_weekly",
      STRIPE_PRICE_SEMESTER: "price_semester",
      STRIPE_PRICE_LIFETIME: "price_lifetime",
    });
    expect(classifySubscription(subscription(), prices)?.plan).toBe("weekly");
    expect(
      classifySubscription(
        subscription({ items: { data: [{ price: { id: "price_unrelated" } }] } }),
        prices
      )
    ).toBeNull();
    expect(classifySubscription(subscription({ status: "canceled" }), prices)).toBeNull();
    expect(
      classifySubscription(
        subscription({ items: { data: [{ price: { id: "price_lifetime" } }] } }),
        prices
      )
    ).toBeNull();
  });

  it("creates an operational-only row without customer names, emails, or payment data", () => {
    const source = subscription();
    const classification = classifySubscription(
      source,
      stripePricePlanMap({ STRIPE_PRICE_WEEKLY: "price_weekly" })
    );
    const row = subscriptionInventoryRow({
      subscription: source,
      item: classification?.item,
      plan: classification?.plan,
      userId: "123e4567-e89b-42d3-a456-426614174000",
      customerId: "cus_researchmatch",
      hasDefaultPaymentMethod: true,
      nowSeconds: 1_800_000_000,
    });
    expect(Object.keys(row)).toEqual(STRIPE_INVENTORY_COLUMNS);
    expect(JSON.stringify(row)).not.toMatch(/email|name|card|payment_method_id/i);
    expect(row.migration_action).toBe("migrate");
  });

  it("escapes CSV cells safely", () => {
    const csv = rowsToCsv([{ value: 'one,"two"' }], ["value"]);
    expect(csv).toBe('value\n"one,""two"""\n');
    expect(parseCsv(csv)).toEqual([{ value: 'one,"two"' }]);
  });

  it("rejects malformed quoted CSV", () => {
    expect(() => parseCsv('value\n"unfinished')).toThrow(/unterminated quoted field/i);
    expect(() => parseCsv('value\n"closed"trailing')).toThrow(/after a closing quote/i);
    expect(() => parseCsv('value\nnot"quoted')).toThrow(/quote inside an unquoted field/i);
    expect(() => parseCsv("one,two\nonly-one")).toThrow(/row length/i);
    expect(() => parseCsv("value,value\none,two")).toThrow(/duplicate headers/i);
  });

  it("flags unresolved source statuses for review", () => {
    const source = subscription({ status: "unpaid" });
    const classification = classifySubscription(
      source,
      stripePricePlanMap({ STRIPE_PRICE_WEEKLY: "price_weekly" })
    );
    const row = subscriptionInventoryRow({
      subscription: source,
      item: classification?.item,
      plan: classification?.plan,
      userId: null,
      customerId: "cus_researchmatch",
      hasDefaultPaymentMethod: false,
    });
    expect(row.migration_action).toBe("review");
    expect(row.has_default_payment_method).toBe("false");
  });

  it("keeps paused ResearchMatch subscriptions in the review inventory", () => {
    const prices = stripePricePlanMap({ STRIPE_PRICE_WEEKLY: "price_weekly" });
    const classification = classifySubscription(subscription({ status: "paused" }), prices);
    expect(classification?.plan).toBe("weekly");
    expect(classification?.migrationReady).toBe(false);
  });
});
