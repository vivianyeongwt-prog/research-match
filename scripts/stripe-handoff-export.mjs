// Read-only source-account export for the ResearchMatch Stripe migration.
// It writes operational IDs only—never names, emails, card data, or API keys.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  STRIPE_INVENTORY_COLUMNS,
  classifySubscription,
  objectId,
  rowsToCsv,
  stripePricePlanMap,
  subscriptionInventoryRow,
  verifiedUserId,
} from "./lib/stripe-handoff.mjs";
import { parseDotenv } from "./lib/buyer-setup-config.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const STRIPE_API_VERSION = "2026-02-25.clover";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function privateWrite(file, source) {
  fs.writeFileSync(file, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function userIdForSubscription(stripe, subscription) {
  const direct = verifiedUserId(subscription.metadata?.userId);
  if (direct) return direct;
  const sessions = await stripe.checkout.sessions.list({
    subscription: subscription.id,
    limit: 10,
  });
  for (const session of sessions.data) {
    const recovered =
      verifiedUserId(session.metadata?.userId) ?? verifiedUserId(session.client_reference_id);
    if (recovered) return recovered;
  }
  return null;
}

async function defaultPaymentMethodState(stripe, subscription, customerId, customerCache) {
  if (
    objectId(subscription.default_payment_method, "pm_") ||
    objectId(subscription.default_source, "card_") ||
    objectId(subscription.default_source, "src_") ||
    objectId(subscription.default_source, "ba_")
  ) {
    return true;
  }
  if (!customerCache.has(customerId)) {
    customerCache.set(customerId, await stripe.customers.retrieve(customerId));
  }
  const customer = customerCache.get(customerId);
  if (!customer || customer.deleted) return false;
  return Boolean(
    objectId(customer.invoice_settings?.default_payment_method, "pm_") ||
      objectId(customer.default_source, "card_") ||
      objectId(customer.default_source, "src_") ||
      objectId(customer.default_source, "ba_")
  );
}

function summaryFor(rows, sourceAccountId) {
  const plans = {};
  const statuses = {};
  for (const row of rows) {
    plans[row.plan] = (plans[row.plan] ?? 0) + 1;
    statuses[row.status] = (statuses[row.status] ?? 0) + 1;
  }
  const missingUserIds = rows.filter((row) => !row.user_id).length;
  const missingPaymentMethods = rows.filter(
    (row) => row.has_default_payment_method !== "true"
  ).length;
  const review = rows.filter((row) => row.migration_action === "review").length;
  const startsTooSoon = rows.filter(
    (row) => typeof row.hours_until_period_end === "number" && row.hours_until_period_end < 24
  ).length;
  return {
    generated_at: new Date().toISOString(),
    source_account_id: sourceAccountId,
    subscriptions: rows.length,
    unique_customers: new Set(rows.map((row) => row.customer_id)).size,
    plans,
    statuses,
    checks: {
      missing_user_ids: missingUserIds,
      missing_default_payment_methods: missingPaymentMethods,
      status_review_required: review,
      current_period_ends_within_24_hours: startsTooSoon,
    },
    ready_for_migration_planning:
      rows.length > 0 && missingUserIds === 0 && missingPaymentMethods === 0 && review === 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const envFile = path.resolve(ROOT, argValue(args, "--env-file") || ".env.local");
  if (!fs.existsSync(envFile)) {
    throw new Error(`${path.relative(ROOT, envFile)} is missing.`);
  }
  const env = { ...process.env, ...parseDotenv(fs.readFileSync(envFile, "utf8")) };
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "");
  if (!secretKey.startsWith("sk_live_") && !(args.includes("--allow-test") && secretKey.startsWith("sk_test_"))) {
    throw new Error("Use the source account's live Stripe key, or pass --allow-test for a sandbox rehearsal.");
  }
  const priceMap = stripePricePlanMap(env);
  if (![...priceMap.values()].includes("weekly") || ![...priceMap.values()].includes("semester")) {
    throw new Error("The source weekly and four-month Stripe prices must be configured first.");
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  const account = await stripe.accounts.retrieve();
  const rows = [];
  const customerCache = new Map();

  for await (const subscription of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    const classification = classifySubscription(subscription, priceMap);
    if (!classification) continue;
    const customerId = objectId(subscription.customer, "cus_");
    if (!customerId) throw new Error(`Subscription ${subscription.id} has no transferable Stripe customer.`);
    const [userId, hasDefaultPaymentMethod] = await Promise.all([
      userIdForSubscription(stripe, subscription),
      defaultPaymentMethodState(stripe, subscription, customerId, customerCache),
    ]);
    rows.push(
      subscriptionInventoryRow({
        subscription,
        item: classification.item,
        plan: classification.plan,
        userId,
        customerId,
        hasDefaultPaymentMethod,
      })
    );
  }

  rows.sort((a, b) => a.plan.localeCompare(b.plan) || a.source_subscription_id.localeCompare(b.source_subscription_id));
  const outputArgument = argValue(args, "--output-dir");
  const outputDirectory = outputArgument
    ? path.resolve(ROOT, outputArgument)
    : path.join(ROOT, ".handoff-private", `stripe-export-${timestamp()}`);
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  try {
    fs.chmodSync(outputDirectory, 0o700);
  } catch {
    // Best-effort on non-POSIX filesystems.
  }

  const customers = [...new Set(rows.map((row) => row.customer_id))].sort();
  const summary = summaryFor(rows, account.id);
  privateWrite(path.join(outputDirectory, "customer-ids.txt"), `${customers.join("\n")}\n`);
  privateWrite(
    path.join(outputDirectory, "subscription-source-inventory.csv"),
    rowsToCsv(rows, STRIPE_INVENTORY_COLUMNS)
  );
  privateWrite(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  privateWrite(
    path.join(outputDirectory, "README.txt"),
    [
      "PRIVATE RESEARCHMATCH STRIPE HANDOFF EXPORT",
      "",
      "This folder contains operational Stripe IDs only. Keep it out of Git, chat, and email.",
      "customer-ids.txt is the ResearchMatch-only customer set for Stripe's partial customer copy.",
      "Use Stripe's current Dashboard template if it requests a CSV; do not assume this text file is the upload format.",
      "subscription-source-inventory.csv is a planning source, not a Billing Migration Toolkit upload.",
      "The destination prices and a start date at least 24 hours in the future are still required.",
      "After Stripe copies the customers, build and validate the destination CSV inside the buyer's Stripe Dashboard.",
      "Do not cancel source subscriptions until destination subscriptions are scheduled and the cutover is verified.",
      "",
    ].join("\n")
  );

  console.log("ResearchMatch Stripe handoff export complete (read-only source audit).");
  console.log(`Subscriptions: ${summary.subscriptions}; customers: ${summary.unique_customers}.`);
  console.log(`Private output: ${path.relative(ROOT, outputDirectory)}`);
  console.log("No names, emails, card data, or API keys were written.");
  if (!summary.ready_for_migration_planning) {
    console.error("The summary contains migration blockers or review items. Resolve them before cutover.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
