import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowRequestRate: vi.fn(),
  requestAccess: vi.fn(),
  from: vi.fn(),
  stripeClient: vi.fn(),
}));

vi.mock("@/lib/server-access", () => ({
  allowRequestRate: mocks.allowRequestRate,
  requestAccess: mocks.requestAccess,
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/lib/stripe-server", () => ({
  stripeClient: mocks.stripeClient,
}));

vi.mock("@/lib/site-url", () => ({
  siteOrigin: () => "https://www.researchmatch.site",
}));

type QueryResult = { data: unknown; error: null | { code?: string; message: string } };

function maybeSingleQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function checkoutRequest(referralCode = "RMABCD1234") {
  return new NextRequest("https://www.researchmatch.site/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify({ priceId: "price_weekly", referralCode }),
  });
}

describe("Buddy Pass checkout attribution", () => {
  let post: (request: NextRequest) => Promise<Response>;
  let createSession: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    ({ POST: post } = await import("../src/app/api/checkout/route"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_WEEKLY = "price_weekly";
    process.env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY = "price_weekly";
    delete process.env.STRIPE_BUDDY_PASS_COUPON_ID;

    mocks.allowRequestRate.mockResolvedValue(true);
    mocks.requestAccess.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" },
      profile: { plan_type: "free" },
      isPaid: false,
    });
    createSession = vi.fn(async () => ({ url: "https://checkout.stripe.test/session" }));
    mocks.stripeClient.mockReturnValue({
      prices: { retrieve: vi.fn(async () => ({ type: "recurring" })) },
      subscriptions: { search: vi.fn(async () => ({ data: [] })) },
      coupons: {
        retrieve: vi.fn(async () => ({
          id: "research_buddy_pass_25",
          valid: true,
          percent_off: 25,
          duration: "once",
        })),
        create: vi.fn(),
      },
      checkout: { sessions: { create: createSession } },
    });
  });

  it("fails visibly instead of silently dropping attribution on a referrer lookup error", async () => {
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe("profiles");
      return maybeSingleQuery({ data: null, error: { message: "database unavailable" } });
    });

    const response = await post(checkoutRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Could not verify that Buddy Pass code. Please try again.",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("places the validated owner, buyer, and code on Stripe Checkout", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return maybeSingleQuery({
          data: { id: "22222222-2222-4222-8222-222222222222", referral_code: "RMABCD1234" },
          error: null,
        });
      }
      if (table === "buddy_pass_referrals") {
        return maybeSingleQuery({ data: null, error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await post(checkoutRequest("rm-abcd-1234"));

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession.mock.calls[0][0]).toMatchObject({
      metadata: {
        userId: "11111111-1111-4111-8111-111111111111",
        referralCode: "RMABCD1234",
        referrerId: "22222222-2222-4222-8222-222222222222",
        referredUserId: "11111111-1111-4111-8111-111111111111",
      },
      subscription_data: {
        metadata: {
          referralCode: "RMABCD1234",
          referrerId: "22222222-2222-4222-8222-222222222222",
        },
      },
      discounts: [{ coupon: "research_buddy_pass_25" }],
    });
  });
});
