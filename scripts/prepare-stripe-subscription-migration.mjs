// Builds and validates a Stripe Billing Migration Toolkit CSV from the private
// source-account inventory. This is read-only against Stripe: it never creates,
// charges, schedules, or cancels a subscription.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./lib/buyer-setup-config.mjs";
import { parseCsv, rowsToCsv } from "./lib/stripe-handoff.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const STRIPE_API_VERSION = "2026-02-25.clover";
const MINIMUM_LEAD_SECONDS = 24 * 60 * 60 + 15 * 60;

const MIGRATION_COLUMNS = Object.freeze([
  "customer",
  "start_date",
  "price",
  "quantity",
  "metadata.source",
  "metadata.old_Stripe_sub_id",
  "metadata.userId",
  "automatic_tax",
  "billing_cycle_anchor",
  "coupon",
  "trial_end",
  "proration_behavior",
  "collection_method",
  "default_tax_rate",
  "backdate_start_date",
  "days_until_due",
  "cancel_at_period_end",
  "add_invoice_items.0.amount",
  "add_invoice_items.0.product",
  "add_invoice_items.0.currency",
]);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasDefaultPaymentMethod(customer) {
  if (!customer || customer.deleted) return false;
  const value = customer.invoice_settings?.default_payment_method ?? customer.default_source;
  const id = typeof value === "string" ? value : value?.id;
  return /^(pm|card|src|ba)_/.test(String(id ?? ""));
}

function migrationRow(source, prices) {
  const price = prices[source.plan];
  if (!price) throw new Error(`No destination price is configured for ${source.plan}.`);
  return {
    customer: source.customer_id,
    start_date: source.current_period_end,
    price,
    quantity: source.quantity || "1",
    "metadata.source": "internal:Stripe",
    "metadata.old_Stripe_sub_id": source.source_subscription_id,
    "metadata.userId": source.user_id,
    automatic_tax: String(source.automatic_tax).toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
    billing_cycle_anchor: "",
    coupon: "",
    trial_end: "",
    proration_behavior: "none",
    collection_method: source.collection_method || "charge_automatically",
    default_tax_rate: "",
    backdate_start_date: "",
    days_until_due: "",
    cancel_at_period_end: String(source.cancel_at_period_end).toUpperCase() === "TRUE" ? "TRUE" : "FALSE",
    "add_invoice_items.0.amount": "",
    "add_invoice_items.0.product": "",
    "add_invoice_items.0.currency": "",
  };
}

function privateWrite(file, source) {
  fs.writeFileSync(file, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function main() {
  const args = process.argv.slice(2);
  const inventoryArgument = argValue(args, "--inventory");
  if (!inventoryArgument) throw new Error("Pass --inventory with the fresh source subscription CSV.");
  const inventoryFile = path.resolve(ROOT, inventoryArgument);
  const envFile = path.resolve(ROOT, argValue(args, "--env-file") || ".env.local");
  if (!fs.existsSync(inventoryFile)) throw new Error("The source subscription inventory does not exist.");
  if (!fs.existsSync(envFile)) throw new Error("The buyer environment file does not exist.");

  const env = { ...process.env, ...parseDotenv(fs.readFileSync(envFile, "utf8")) };
  const secret = String(env.STRIPE_SECRET_KEY ?? "");
  if (!secret.startsWith("sk_live_")) throw new Error("Use the buyer account's live Stripe key.");
  const expectedAccount = String(env.BUYER_STRIPE_ACCOUNT_ID ?? "");
  const prices = {
    weekly: String(env.STRIPE_PRICE_WEEKLY ?? ""),
    semester: String(env.STRIPE_PRICE_SEMESTER ?? ""),
  };
  if (!expectedAccount.startsWith("acct_") || Object.values(prices).some((value) => !value.startsWith("price_"))) {
    throw new Error("Buyer account and recurring destination prices must be configured first.");
  }

  const sourceRows = parseCsv(fs.readFileSync(inventoryFile, "utf8")).filter(
    (row) => row.migration_action === "migrate" && row.status === "active"
  );
  if (sourceRows.length === 0) throw new Error("The source inventory has no active subscriptions to migrate.");

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  const account = await stripe.accounts.retrieve();
  if (account.id !== expectedAccount) {
    throw new Error(`The destination key belongs to ${account.id}, not ${expectedAccount}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const threshold = now + MINIMUM_LEAD_SECONDS;
  const ready = [];
  const deferred = [];
  const missingCustomers = [];
  const missingPaymentMethods = [];

  for (const source of sourceRows) {
    let customer;
    try {
      customer = await stripe.customers.retrieve(source.customer_id);
    } catch (error) {
      if (error?.code === "resource_missing") {
        missingCustomers.push(source.customer_id);
        continue;
      }
      throw error;
    }
    if (!hasDefaultPaymentMethod(customer)) {
      missingPaymentMethods.push(source.customer_id);
      continue;
    }
    if (Number(source.current_period_end) < threshold) deferred.push(source);
    else ready.push(migrationRow(source, prices));
  }

  if (missingCustomers.length > 0 || missingPaymentMethods.length > 0) {
    throw new Error(
      `Destination validation failed: ${missingCustomers.length} missing customers; ` +
        `${missingPaymentMethods.length} missing default payment methods.`
    );
  }

  const outputArgument = argValue(args, "--output-dir");
  const outputDirectory = outputArgument
    ? path.resolve(ROOT, outputArgument)
    : path.join(ROOT, ".handoff-private", `stripe-migration-${timestamp()}`);
  fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  try {
    fs.chmodSync(outputDirectory, 0o700);
  } catch {
    // Best-effort on non-POSIX filesystems.
  }

  privateWrite(path.join(outputDirectory, "billing-migration-ready.csv"), rowsToCsv(ready, MIGRATION_COLUMNS));
  privateWrite(
    path.join(outputDirectory, "deferred-source-subscriptions.csv"),
    rowsToCsv(deferred, Object.keys(sourceRows[0]))
  );
  privateWrite(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        destination_account_id: account.id,
        source_inventory: path.relative(ROOT, inventoryFile),
        ready: ready.length,
        deferred: deferred.length,
        minimum_lead_seconds: MINIMUM_LEAD_SECONDS,
        destination_customers_verified: sourceRows.length,
        destination_default_payment_methods_verified: sourceRows.length,
      },
      null,
      2
    )}\n`
  );

  console.log("Stripe Billing migration CSV prepared (destination validation was read-only).");
  console.log(`Ready: ${ready.length}; deferred for a later renewal window: ${deferred.length}.`);
  console.log(`Private output: ${path.relative(ROOT, outputDirectory)}`);
  console.log("Every destination customer and default payment method was verified.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
