import { describe, expect, it } from "vitest";
import { requiredServerSetting } from "../src/lib/server-env";
import {
  stripeSecretKey,
  stripeWebhookSecret,
} from "../src/lib/stripe-server";

describe("server environment configuration", () => {
  it("rejects missing and blank required settings", () => {
    expect(() => requiredServerSetting("EXAMPLE", {})).toThrow(
      "EXAMPLE is not configured."
    );
    expect(() => requiredServerSetting("EXAMPLE", { EXAMPLE: "   " })).toThrow(
      "EXAMPLE is not configured."
    );
  });

  it("returns trimmed values without exposing a fallback secret", () => {
    expect(requiredServerSetting("EXAMPLE", { EXAMPLE: " value " })).toBe("value");
  });

  it("validates both Stripe secrets through the shared environment boundary", () => {
    const env = {
      STRIPE_SECRET_KEY: " server-key ",
      STRIPE_WEBHOOK_SECRET: " webhook-secret ",
    } satisfies Record<string, string | undefined>;
    expect(stripeSecretKey(env)).toBe("server-key");
    expect(stripeWebhookSecret(env)).toBe("webhook-secret");
  });
});
