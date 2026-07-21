import { describe, expect, it } from "vitest";
import {
  generateReferralCode,
  hasActiveBuddyPass,
  hasPaidAccess,
  hasPaidPlan,
  normalizeReferralCode,
  planLabelFor,
} from "../src/lib/buddy-pass";

const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("Buddy Pass and plan access", () => {
  it("normalizes referral input and derives stable referral codes", () => {
    expect(normalizeReferralCode(" ab-c_12 + long-code-value ")).toBe("ABC12LONGCODEVAL");
    expect(generateReferralCode("abcd1234-5678-90ab-cdef-1234567890ab")).toBe("RMABCD1234");
  });

  it("keeps lifetime access uncapped", () => {
    expect(hasPaidPlan({ plan_type: "lifetime", plan_expires_at: "2020-01-01T00:00:00.000Z" }, NOW)).toBe(true);
  });

  it("honors active and expired time-limited plans", () => {
    expect(hasPaidPlan({ plan_type: "semester", plan_expires_at: "2026-07-21T00:00:00.000Z" }, NOW)).toBe(true);
    expect(hasPaidPlan({ plan_type: "semester", plan_expires_at: "2026-07-19T00:00:00.000Z" }, NOW)).toBe(false);
    expect(hasPaidPlan({ plan_type: "free", plan_expires_at: null }, NOW)).toBe(false);
  });

  it("grants temporary access only while a Buddy Pass is active", () => {
    const active = { plan_type: "free", buddy_pass_active_until: "2026-07-21T00:00:00.000Z" };
    const expired = { plan_type: "free", buddy_pass_active_until: "2026-07-19T00:00:00.000Z" };
    expect(hasActiveBuddyPass(active, NOW)).toBe(true);
    expect(hasPaidAccess(active, NOW)).toBe(true);
    expect(hasActiveBuddyPass(expired, NOW)).toBe(false);
    expect(hasPaidAccess(expired, NOW)).toBe(false);
  });

  it("labels the supported sale plans consistently", () => {
    expect(planLabelFor({ plan_type: "lifetime" })).toBe("Lifetime");
    expect(planLabelFor({ plan_type: "weekly" })).toBe("Weekly");
    expect(planLabelFor({ plan_type: "student_annual" })).toBe("Semester");
    expect(planLabelFor({ plan_type: "free", buddy_pass_active_until: "2999-01-01T00:00:00.000Z" })).toBe("Buddy Pass");
    expect(planLabelFor({ plan_type: "free" })).toBe("Free");
  });
});
