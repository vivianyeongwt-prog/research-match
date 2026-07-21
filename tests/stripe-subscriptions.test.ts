import { describe, expect, it } from "vitest";
import {
  isCurrentSubscription,
  isPortalSubscription,
} from "../src/lib/stripe-subscriptions";

describe("Stripe subscription states", () => {
  it("keeps access for active and recoverable billing states", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"] as const) {
      expect(isCurrentSubscription({ status })).toBe(true);
    }
    for (const status of ["canceled", "incomplete_expired", "paused"] as const) {
      expect(isCurrentSubscription({ status })).toBe(false);
    }
  });

  it("uses the portal only for non-canceling active subscriptions", () => {
    expect(
      isPortalSubscription({ status: "active", cancel_at_period_end: false })
    ).toBe(true);
    expect(
      isPortalSubscription({ status: "active", cancel_at_period_end: true })
    ).toBe(false);
    expect(
      isPortalSubscription({ status: "unpaid", cancel_at_period_end: false })
    ).toBe(false);
  });
});
