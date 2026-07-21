import { describe, expect, it } from "vitest";
import {
  currentCheckoutPriceIds,
  paidPlanFromPriceId,
  verifiedUserId,
} from "../src/lib/stripe-plans";

const env = {
  NODE_ENV: "test",
  STRIPE_PRICE_WEEKLY: "price_weekly_server",
  NEXT_PUBLIC_STRIPE_PRICE_WEEKLY: "price_weekly_public",
  STRIPE_PRICE_SEMESTER: "price_semester_server",
  NEXT_PUBLIC_STRIPE_PRICE_SEMESTER: "price_semester_public",
  STRIPE_PRICE_LIFETIME: "price_lifetime_server",
  NEXT_PUBLIC_STRIPE_PRICE_LIFETIME: "price_lifetime_public",
  STRIPE_LEGACY_WEEKLY_PRICE_IDS: "price_weekly_old, price_weekly_older",
  STRIPE_LEGACY_SEMESTER_PRICE_IDS: "price_semester_old",
  STRIPE_LEGACY_LIFETIME_PRICE_IDS: "price_lifetime_old",
} satisfies NodeJS.ProcessEnv;

describe("Stripe access-plan mapping", () => {
  it("maps each explicitly configured current price to the correct plan", () => {
    expect(paidPlanFromPriceId("price_weekly_server", env)).toBe("weekly");
    expect(paidPlanFromPriceId("price_weekly_public", env)).toBe("weekly");
    expect(paidPlanFromPriceId("price_semester_server", env)).toBe("semester");
    expect(paidPlanFromPriceId("price_semester_public", env)).toBe("semester");
    expect(paidPlanFromPriceId("price_lifetime_server", env)).toBe("lifetime");
    expect(paidPlanFromPriceId("price_lifetime_public", env)).toBe("lifetime");
  });

  it("recognizes explicitly inventoried legacy prices", () => {
    expect(paidPlanFromPriceId("price_weekly_older", env)).toBe("weekly");
    expect(paidPlanFromPriceId("price_semester_old", env)).toBe("semester");
    expect(paidPlanFromPriceId("price_lifetime_old", env)).toBe("lifetime");
  });

  it("fails closed for missing and unknown prices", () => {
    expect(paidPlanFromPriceId("price_unrelated", env)).toBeNull();
    expect(paidPlanFromPriceId("", env)).toBeNull();
    expect(paidPlanFromPriceId(null, env)).toBeNull();
  });

  it("allows checkout creation only for current prices, never legacy prices", () => {
    const allowed = currentCheckoutPriceIds(env);
    expect(allowed).toContain("price_weekly_server");
    expect(allowed).toContain("price_semester_public");
    expect(allowed).toContain("price_lifetime_server");
    expect(allowed).not.toContain("price_weekly_old");
    expect(allowed).not.toContain("price_semester_old");
    expect(allowed).not.toContain("price_lifetime_old");
  });

  it("accepts only UUID-shaped Supabase user IDs", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(verifiedUserId(id)).toBe(id);
    expect(verifiedUserId("not-a-user-id")).toBeNull();
    expect(verifiedUserId("123e4567-e89b-02d3-a456-426614174000")).toBeNull();
    expect(verifiedUserId(null)).toBeNull();
  });
});
