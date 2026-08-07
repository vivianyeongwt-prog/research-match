// Verifies destination schedules created by Stripe's Billing migration toolkit,
// then optionally stops the matching source subscriptions at their existing
// period ends. It never cancels immediately and never touches a source
// subscription absent from the exact migration CSV.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./lib/buyer-setup-config.mjs";
import { objectId, parseCsv } from "./lib/stripe-handoff.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const STRIPE_API_VERSION = "2026-02-25.clover";

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function requiredFile(args, name, fallback = null) {
  const value = argValue(args, name) || fallback;
  if (!value) throw new Error(`Pass ${name}.`);
  const file = path.resolve(ROOT, value);
  if (!fs.existsSync(file)) throw new Error(`${name} does not exist.`);
  return file;
}

function environment(file) {
  return { ...process.env, ...parseDotenv(fs.readFileSync(file, "utf8")) };
}

function liveSecret(env, label) {
  const value = String(env.STRIPE_SECRET_KEY ?? "");
  if (!value.startsWith("sk_live_")) throw new Error(`${label} must contain a live Stripe key.`);
  return value;
}

function priceId(value) {
  return typeof value === "string" ? value : value?.id;
}

function itemPeriodEnd(subscription) {
  const items = subscription.items?.data ?? [];
  if (items.length !== 1) throw new Error("A source subscription no longer has exactly one item.");
  return Number(items[0].current_period_end ?? 0);
}

function recurringPriceMatches(sourcePrice, destinationPrice) {
  return Boolean(
    destinationPrice?.active &&
      sourcePrice?.currency === destinationPrice.currency &&
      sourcePrice?.unit_amount === destinationPrice.unit_amount &&
      sourcePrice?.recurring?.interval === destinationPrice.recurring?.interval &&
      sourcePrice?.recurring?.interval_count === destinationPrice.recurring?.interval_count
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sourceEnvFile = requiredFile(args, "--source-env-file");
  const destinationEnvFile = requiredFile(args, "--destination-env-file", ".env.local");
  const migrationFile = requiredFile(args, "--migration-csv");
  const expectedSourceAccount = String(argValue(args, "--source-account") ?? "");
  if (!expectedSourceAccount.startsWith("acct_")) throw new Error("Pass --source-account.");

  const sourceEnv = environment(sourceEnvFile);
  const destinationEnv = environment(destinationEnvFile);
  const expectedDestinationAccount = String(destinationEnv.BUYER_STRIPE_ACCOUNT_ID ?? "");
  if (!expectedDestinationAccount.startsWith("acct_")) {
    throw new Error("BUYER_STRIPE_ACCOUNT_ID is missing from the destination environment.");
  }
  if (expectedSourceAccount === expectedDestinationAccount) {
    throw new Error("Source and destination Stripe accounts must be different.");
  }

  const rows = parseCsv(fs.readFileSync(migrationFile, "utf8"));
  if (rows.length === 0) throw new Error("The migration CSV has no subscriptions.");
  const rowsBySubscription = new Map();
  for (const row of rows) {
    const subscriptionId = row["metadata.old_Stripe_sub_id"];
    if (!subscriptionId?.startsWith("sub_") || !row.customer?.startsWith("cus_") || !row.price?.startsWith("price_")) {
      throw new Error("The migration CSV contains an invalid subscription, customer, or price ID.");
    }
    if (rowsBySubscription.has(subscriptionId)) throw new Error("The migration CSV repeats a source subscription.");
    rowsBySubscription.set(subscriptionId, row);
  }

  const { default: Stripe } = await import("stripe");
  const sourceStripe = new Stripe(liveSecret(sourceEnv, "Source environment"), {
    apiVersion: STRIPE_API_VERSION,
  });
  const destinationStripe = new Stripe(liveSecret(destinationEnv, "Destination environment"), {
    apiVersion: STRIPE_API_VERSION,
  });
  const [sourceAccount, destinationAccount] = await Promise.all([
    sourceStripe.accounts.retrieve(),
    destinationStripe.accounts.retrieve(),
  ]);
  if (sourceAccount.id !== expectedSourceAccount || destinationAccount.id !== expectedDestinationAccount) {
    throw new Error("A Stripe key does not belong to the expected source or destination account.");
  }

  const schedulesBySourceSubscription = new Map();
  for await (const schedule of destinationStripe.subscriptionSchedules.list({ limit: 100 })) {
    const sourceSubscriptionId = schedule.metadata?.old_Stripe_sub_id;
    if (!rowsBySubscription.has(sourceSubscriptionId)) continue;
    if (schedulesBySourceSubscription.has(sourceSubscriptionId)) {
      throw new Error("Stripe created duplicate destination schedules for a source subscription.");
    }
    schedulesBySourceSubscription.set(sourceSubscriptionId, schedule);
  }
  if (schedulesBySourceSubscription.size !== rows.length) {
    throw new Error("The number of destination schedules does not match the migration CSV.");
  }

  const sourceChanges = [];
  let alreadyStopping = 0;
  for (const [subscriptionId, row] of rowsBySubscription) {
    const schedule = schedulesBySourceSubscription.get(subscriptionId);
    const phases = schedule?.phases ?? [];
    if (!schedule || schedule.status !== "not_started" || phases.length !== 1) {
      throw new Error("A destination schedule is missing, already active, or has unexpected phases.");
    }
    const phase = phases[0];
    const items = phase.items ?? [];
    if (
      schedule.end_behavior !== "release" ||
      objectId(schedule.customer, "cus_") !== row.customer ||
      schedule.metadata?.old_Stripe_sub_id !== subscriptionId ||
      Number(phase.start_date) !== Number(row.start_date) ||
      Number(phase.end_date) <= Number(phase.start_date) ||
      phase.proration_behavior !== "none" ||
      phase.automatic_tax?.enabled !== false ||
      Boolean(phase.trial_end) ||
      (phase.discounts?.length ?? 0) !== 0 ||
      items.length !== 1 ||
      priceId(items[0].price) !== row.price ||
      Number(items[0].quantity ?? 1) !== Number(row.quantity || 1) ||
      phase.collection_method !== (row.collection_method || "charge_automatically") ||
      schedule.metadata?.userId !== row["metadata.userId"] ||
      schedule.metadata?.source !== row["metadata.source"]
    ) {
      throw new Error("A destination schedule does not exactly match its migration row.");
    }

    const [destinationCustomer, destinationPrice] = await Promise.all([
      destinationStripe.customers.retrieve(row.customer),
      destinationStripe.prices.retrieve(row.price),
    ]);
    if (
      !destinationCustomer ||
      destinationCustomer.deleted ||
      !objectId(destinationCustomer.invoice_settings?.default_payment_method, "pm_")
    ) {
      throw new Error("A scheduled destination customer no longer has a default payment method.");
    }

    const sourceSubscription = await sourceStripe.subscriptions.retrieve(subscriptionId);
    if (
      sourceSubscription.status !== "active" ||
      objectId(sourceSubscription.customer, "cus_") !== row.customer ||
      itemPeriodEnd(sourceSubscription) !== Number(row.start_date) ||
      sourceSubscription.collection_method !== "charge_automatically" ||
      sourceSubscription.automatic_tax?.enabled ||
      sourceSubscription.trial_end ||
      (sourceSubscription.discounts?.length ?? 0) !== 0 ||
      (sourceSubscription.items.data[0]?.discounts?.length ?? 0) !== 0 ||
      Number(sourceSubscription.items.data[0]?.quantity ?? 1) !== Number(row.quantity || 1) ||
      !recurringPriceMatches(sourceSubscription.items.data[0]?.price, destinationPrice)
    ) {
      throw new Error("A source subscription changed after the destination schedule was created.");
    }
    if (sourceSubscription.cancel_at_period_end) alreadyStopping += 1;
    else sourceChanges.push(subscriptionId);
  }

  console.log(`Verified ${rows.length} exact destination schedules and source subscriptions.`);
  console.log(`Already stopping at period end: ${alreadyStopping}; source updates planned: ${sourceChanges.length}.`);
  if (!apply) {
    console.log("Plan only. Re-run with --apply to set only these source subscriptions to cancel at period end.");
    return;
  }

  for (const subscriptionId of sourceChanges) {
    await sourceStripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
  for (const subscriptionId of sourceChanges) {
    const subscription = await sourceStripe.subscriptions.retrieve(subscriptionId);
    if (!subscription.cancel_at_period_end) {
      throw new Error("Stripe did not persist a source period-end cancellation.");
    }
  }
  console.log(`Applied and verified ${sourceChanges.length} source period-end cancellations.`);
  console.log("No source subscription was ended early and the deferred subscriber was not touched.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
