export type PaidPlanType = "weekly" | "semester" | "lifetime";

function ids(...values: Array<string | undefined>) {
  return new Set(values.flatMap((value) => (value ?? "").split(",")).map((value) => value.trim()).filter(Boolean));
}

/** Current prices the application is allowed to create a checkout for. */
export function currentCheckoutPriceIds(env: NodeJS.ProcessEnv = process.env) {
  return ids(
    env.STRIPE_PRICE_WEEKLY,
    env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY,
    env.STRIPE_PRICE_SEMESTER,
    env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER,
    env.STRIPE_PRICE_LIFETIME,
    env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME
  );
}

/**
 * Convert only explicitly configured current or legacy Stripe prices to access.
 * Unknown prices fail closed instead of silently granting a Semester plan.
 */
export function paidPlanFromPriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): PaidPlanType | null {
  if (!priceId) return null;
  if (ids(env.STRIPE_PRICE_WEEKLY, env.NEXT_PUBLIC_STRIPE_PRICE_WEEKLY, env.STRIPE_LEGACY_WEEKLY_PRICE_IDS).has(priceId)) {
    return "weekly";
  }
  if (ids(env.STRIPE_PRICE_SEMESTER, env.NEXT_PUBLIC_STRIPE_PRICE_SEMESTER, env.STRIPE_LEGACY_SEMESTER_PRICE_IDS).has(priceId)) {
    return "semester";
  }
  if (ids(env.STRIPE_PRICE_LIFETIME, env.NEXT_PUBLIC_STRIPE_PRICE_LIFETIME, env.STRIPE_LEGACY_LIFETIME_PRICE_IDS).has(priceId)) {
    return "lifetime";
  }
  return null;
}

export function verifiedUserId(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
