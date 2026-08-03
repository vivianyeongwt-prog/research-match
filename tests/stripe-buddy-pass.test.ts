import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/server-access", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

describe("Buddy Pass financial reversals", () => {
  let voidRewards: typeof import("../src/lib/stripe-buddy-pass").voidBuddyPassRewardsForCheckoutSessions;

  beforeAll(async () => {
    ({ voidBuddyPassRewardsForCheckoutSessions: voidRewards } = await import(
      "../src/lib/stripe-buddy-pass"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates Checkout Sessions before voiding a refunded reward", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    await expect(voidRewards(["cs_test", "cs_test"])).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("void_buddy_pass_rewards", {
      p_checkout_session_ids: ["cs_test"],
    });
  });

  it("keeps the Stripe event retryable when the reversal fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "temporary failure" } });

    await expect(voidRewards(["cs_test"])).resolves.toBe(true);
  });
});
