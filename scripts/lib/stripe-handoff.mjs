const CURRENT_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

const MIGRATION_READY_STATUSES = new Set(["active", "trialing", "past_due"]);

function values(env, name) {
  return String(env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function stripePricePlanMap(env) {
  const map = new Map();
  for (const id of [
    ...values(env, "STRIPE_PRICE_WEEKLY"),
    ...values(env, "NEXT_PUBLIC_STRIPE_PRICE_WEEKLY"),
    ...values(env, "STRIPE_LEGACY_WEEKLY_PRICE_IDS"),
  ]) {
    map.set(id, "weekly");
  }
  for (const id of [
    ...values(env, "STRIPE_PRICE_SEMESTER"),
    ...values(env, "NEXT_PUBLIC_STRIPE_PRICE_SEMESTER"),
    ...values(env, "STRIPE_LEGACY_SEMESTER_PRICE_IDS"),
  ]) {
    map.set(id, "semester");
  }
  for (const id of [
    ...values(env, "STRIPE_PRICE_LIFETIME"),
    ...values(env, "NEXT_PUBLIC_STRIPE_PRICE_LIFETIME"),
    ...values(env, "STRIPE_LEGACY_LIFETIME_PRICE_IDS"),
  ]) {
    map.set(id, "lifetime");
  }
  return map;
}

export function objectId(value, prefix) {
  const id = typeof value === "string" ? value : value?.id;
  return typeof id === "string" && id.startsWith(prefix) ? id : null;
}

export function verifiedUserId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function classifySubscription(subscription, priceMap) {
  if (!CURRENT_SUBSCRIPTION_STATUSES.has(subscription.status)) return null;
  const mappedItems = (subscription.items?.data ?? [])
    .map((item) => ({ item, plan: priceMap.get(item.price?.id) ?? null }))
    .filter((entry) => entry.plan && entry.plan !== "lifetime");
  if (mappedItems.length === 0) return null;
  if (mappedItems.length !== 1 || (subscription.items?.data?.length ?? 0) !== 1) {
    throw new Error(`Subscription ${subscription.id} does not have exactly one ResearchMatch price.`);
  }
  return {
    item: mappedItems[0].item,
    plan: mappedItems[0].plan,
    migrationReady: MIGRATION_READY_STATUSES.has(subscription.status),
  };
}

export function subscriptionInventoryRow({
  subscription,
  item,
  plan,
  userId,
  customerId,
  hasDefaultPaymentMethod,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const periodEnd = Number(item.current_period_end ?? 0);
  return {
    source_subscription_id: subscription.id,
    customer_id: customerId,
    source_price_id: item.price.id,
    plan,
    quantity: item.quantity ?? 1,
    status: subscription.status,
    user_id: userId ?? "",
    current_period_end: periodEnd || "",
    hours_until_period_end: periodEnd
      ? Math.round(((periodEnd - nowSeconds) / 3600) * 10) / 10
      : "",
    source_start_date: subscription.start_date ?? "",
    cancel_at_period_end: subscription.cancel_at_period_end ? "true" : "false",
    collection_method: subscription.collection_method ?? "charge_automatically",
    automatic_tax: subscription.automatic_tax?.enabled ? "true" : "false",
    has_default_payment_method: hasDefaultPaymentMethod ? "true" : "false",
    migration_action: MIGRATION_READY_STATUSES.has(subscription.status) ? "migrate" : "review",
  };
}

function csvCell(value) {
  const source = String(value ?? "");
  return /[",\r\n]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
}

export function rowsToCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

export const STRIPE_INVENTORY_COLUMNS = Object.freeze([
  "source_subscription_id",
  "customer_id",
  "source_price_id",
  "plan",
  "quantity",
  "status",
  "user_id",
  "current_period_end",
  "hours_until_period_end",
  "source_start_date",
  "cancel_at_period_end",
  "collection_method",
  "automatic_tax",
  "has_default_payment_method",
  "migration_action",
]);
