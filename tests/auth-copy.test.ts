import { describe, expect, it } from "vitest";
import { signupSuccessMessage } from "../src/lib/auth-copy";

describe("signupSuccessMessage", () => {
  it("does not ask auto-confirmed users to confirm an email", () => {
    expect(signupSuccessMessage({
      promoApplied: false,
      promoPending: false,
      confirmationRequired: false,
    })).toBe("Account created! You’re ready to start.");
  });

  it("asks users to finish confirmation only when their session is pending", () => {
    expect(signupSuccessMessage({
      promoApplied: false,
      promoPending: false,
      confirmationRequired: true,
    })).toBe("Account created! Check your email to finish signing in.");
  });

  it("explains that a pending promo activates after confirmation", () => {
    expect(signupSuccessMessage({
      promoApplied: false,
      promoPending: true,
      confirmationRequired: true,
    })).toBe("Account created! Confirm your email to activate the promo code.");
  });

  it("reports immediately applied Student access without false confirmation copy", () => {
    expect(signupSuccessMessage({
      promoApplied: true,
      promoPending: false,
      confirmationRequired: false,
    })).toBe("Account created with Student access! You’re ready to start.");
  });
});
