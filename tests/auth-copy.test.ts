import { describe, expect, it } from "vitest";
import { signupSuccessMessage } from "../src/lib/auth-copy";

describe("signupSuccessMessage", () => {
  it("does not ask auto-confirmed users to confirm an email", () => {
    expect(signupSuccessMessage({
      confirmationRequired: false,
    })).toBe("Account created! You’re ready to start.");
  });

  it("asks users to finish confirmation only when their session is pending", () => {
    expect(signupSuccessMessage({
      confirmationRequired: true,
    })).toBe("Account created! Check your email to finish signing in.");
  });
});
