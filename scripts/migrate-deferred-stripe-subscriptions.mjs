// Safely schedules subscriptions that fall inside the Billing migration
// toolkit's 24-hour upload cutoff. Default mode is read-only. --apply creates
// one-period destination schedules through Stripe's official API and only then
// sets the matching source subscriptions to stop at their existing period ends.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./lib/buyer-setup-config.mjs";
import { objectId, parseCsv, verifiedUserId } from "./lib/stripe-handoff.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const STRIPE_API_VERSION = "2026-02-25.clover";
const MINIMUM_DIRECT_LEAD_SECONDS = 15 * 60;

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

function scheduleMatches(schedule, expected) {
  const phases = schedule?.phases ?? [];
  const phase = phases[0];
  const items = phase?.items ?? [];
  return Boolean(
    schedule &&
      schedule.status === "not_started" &&
      schedule.end_behavior === "release" &&
      objectId(schedule.customer, "cus_") === expected.customer &&
      schedule.metadata?.old_Stripe_sub_id === expected.sourceSubscription &&
      schedule.metadata?.source === "internal:Stripe" &&
      schedule.metadata?.userId === expected.userId &&
      Number(phase?.start_date) === expected.startDate &&
      Number(phase?.end_date) === expected.endDate &&
      phase?.collection_method === "charge_automatically" &&
      phase?.proration_behavior === "none" &&
      phase?.automatic_tax?.enabled === false &&
      items.length === 1 &&
      priceId(items[0].price) === expected.price &&
      Number(items[0].quantity ?? 1) === expected.quantity
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sourceEnvFile = requiredFile(args, "--source-env-file");
  const destinationEnvFile = requiredFile(args, "--destination-env-file", ".env.local");
  const deferredFile = requiredFile(args, "--deferred-csv");
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

  const rows = parseCsv(fs.readFileSync(deferredFile, "utf8"));
  if (rows.length === 0) throw new Error("The deferred inventory is empty.");

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

  const existingSchedules = [];
  for await (const schedule of destinationStripe.subscriptionSchedules.list({ limit: 100 })) {
    existingSchedules.push(schedule);
  }

  const plans = [];
  for (const row of rows) {
    const sourceSubscriptionId = String(row.source_subscription_id ?? "");
    const customerId = String(row.customer_id ?? "");
    const userId = verifiedUserId(row.user_id);
    const plan = String(row.plan ?? "");
    const destinationPriceId = String(
      plan === "weekly" ? destinationEnv.STRIPE_PRICE_WEEKLY : destinationEnv.STRIPE_PRICE_SEMESTER
    );
    const quantity = Number(row.quantity || 1);
    const startDate = Number(row.current_period_end);
    if (
      !sourceSubscriptionId.startsWith("sub_") ||
      !customerId.startsWith("cus_") ||
      !userId ||
      !["weekly", "semester"].includes(plan) ||
      !destinationPriceId.startsWith("price_") ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !Number.isInteger(startDate)
    ) {
      throw new Error("A deferred inventory row is incomplete or malformed.");
    }
    if (startDate <= Math.floor(Date.now() / 1000) + MINIMUM_DIRECT_LEAD_SECONDS) {
      throw new Error("A deferred subscription is now too close to its renewal; wait for renewal and regenerate the source inventory.");
    }

    const [sourceSubscription, destinationCustomer, destinationPrice] = await Promise.all([
      sourceStripe.subscriptions.retrieve(sourceSubscriptionId),
      destinationStripe.customers.retrieve(customerId),
      destinationStripe.prices.retrieve(destinationPriceId),
    ]);
    const sourceItems = sourceSubscription.items?.data ?? [];
    const sourceItem = sourceItems[0];
    if (
      sourceSubscription.status !== "active" ||
      objectId(sourceSubscription.customer, "cus_") !== customerId ||
      sourceItems.length !== 1 ||
      Number(sourceItem.current_period_end) !== startDate ||
      Number(sourceItem.quantity ?? 1) !== quantity ||
      (sourceSubscription.discounts?.length ?? 0) !== 0 ||
      (sourceItem.discounts?.length ?? 0) !== 0 ||
      sourceSubscription.trial_end ||
      sourceSubscription.automatic_tax?.enabled ||
      sourceSubscription.collection_method !== "charge_automatically"
    ) {
      throw new Error("A deferred source subscription has unsupported or changed billing settings.");
    }
    if (
      !destinationCustomer ||
      destinationCustomer.deleted ||
      !objectId(destinationCustomer.invoice_settings?.default_payment_method, "pm_")
    ) {
      throw new Error("A deferred destination customer lacks a default payment method.");
    }

    const sourcePrice = sourceItem.price;
    if (
      !destinationPrice.active ||
      !destinationPrice.recurring ||
      sourcePrice.currency !== destinationPrice.currency ||
      sourcePrice.unit_amount !== destinationPrice.unit_amount ||
      sourcePrice.recurring?.interval !== destinationPrice.recurring.interval ||
      sourcePrice.recurring?.interval_count !== destinationPrice.recurring.interval_count
    ) {
      throw new Error("A deferred destination price does not match the source subscription price.");
    }

    const interval = destinationPrice.recurring.interval;
    const intervalCount = destinationPrice.recurring.interval_count;
    const secondsPerInterval = { day: 86400, week: 604800 }[interval];
    if (!secondsPerInterval || intervalCount !== 1) {
      throw new Error("The direct deferred path currently supports the verified weekly plan only.");
    }
    const expected = {
      sourceSubscription: sourceSubscriptionId,
      customer: customerId,
      userId,
      price: destinationPriceId,
      quantity,
      startDate,
      endDate: startDate + secondsPerInterval,
    };
    const matches = existingSchedules.filter(
      (schedule) => schedule.metadata?.old_Stripe_sub_id === sourceSubscriptionId
    );
    if (matches.length > 1) throw new Error("Duplicate destination schedules exist for a deferred subscription.");
    if (matches.length === 1 && !scheduleMatches(matches[0], expected)) {
      throw new Error("An existing deferred destination schedule does not match the source.");
    }
    plans.push({ expected, sourceSubscription, existingSchedule: matches[0] ?? null });
  }

  const toCreate = plans.filter((plan) => !plan.existingSchedule);
  const toStop = plans.filter((plan) => !plan.sourceSubscription.cancel_at_period_end);
  console.log(`Validated ${plans.length} deferred source subscriptions and destination payment methods.`);
  console.log(`Destination schedules to create: ${toCreate.length}; source period-end stops to set: ${toStop.length}.`);
  if (!apply) {
    console.log("Plan only. Re-run with --apply to perform the verified direct migration.");
    return;
  }

  for (const plan of toCreate) {
    const { expected } = plan;
    const metadata = {
      source: "internal:Stripe",
      old_Stripe_sub_id: expected.sourceSubscription,
      userId: expected.userId,
      migration_method: "api_deferred_cutoff",
    };
    const schedule = await destinationStripe.subscriptionSchedules.create(
      {
        customer: expected.customer,
        start_date: expected.startDate,
        end_behavior: "release",
        billing_mode: {
          type: "flexible",
          flexible: { proration_discounts: "included" },
        },
        default_settings: {
          billing_cycle_anchor: "automatic",
          collection_method: "charge_automatically",
          automatic_tax: { enabled: false },
        },
        phases: [
          {
            items: [{ price: expected.price, quantity: expected.quantity }],
            duration: { interval: "week", interval_count: 1 },
            collection_method: "charge_automatically",
            automatic_tax: { enabled: false },
            proration_behavior: "none",
            metadata,
          },
        ],
        metadata,
      },
      { idempotencyKey: `researchmatch-deferred-${expected.sourceSubscription}` }
    );
    if (!scheduleMatches(schedule, expected)) {
      throw new Error("Stripe created a deferred destination schedule with unexpected settings; source remains active.");
    }
  }

  for (const plan of toStop) {
    await sourceStripe.subscriptions.update(plan.expected.sourceSubscription, {
      cancel_at_period_end: true,
    });
  }
  for (const plan of plans) {
    const sourceSubscription = await sourceStripe.subscriptions.retrieve(
      plan.expected.sourceSubscription
    );
    if (!sourceSubscription.cancel_at_period_end) {
      throw new Error("Stripe did not persist a deferred source period-end cancellation.");
    }
    const matches = [];
    for await (const schedule of destinationStripe.subscriptionSchedules.list({ limit: 100 })) {
      if (schedule.metadata?.old_Stripe_sub_id === plan.expected.sourceSubscription) {
        matches.push(schedule);
      }
    }
    if (matches.length !== 1 || !scheduleMatches(matches[0], plan.expected)) {
      throw new Error("The deferred destination schedule failed final verification.");
    }
  }
  console.log(`Created and verified ${toCreate.length} deferred destination schedules.`);
  console.log(`Applied and verified ${toStop.length} deferred source period-end cancellations.`);
  console.log("No source subscription was ended early.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
