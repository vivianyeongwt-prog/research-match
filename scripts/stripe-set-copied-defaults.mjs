// Re-links copied Stripe payment methods as destination customer defaults.
// The default mode is a read-only plan. --apply changes only each destination
// customer's invoice_settings.default_payment_method; it never charges or
// creates, schedules, updates, or cancels a subscription.

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

function requiredFile(args, name) {
  const value = argValue(args, name);
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

async function effectiveSourceDefault(stripe, subscription, customerId) {
  const direct = objectId(subscription.default_payment_method, "pm_");
  if (direct) return direct;
  const customer = await stripe.customers.retrieve(customerId);
  if (!customer || customer.deleted) throw new Error("A source customer is missing or deleted.");
  return objectId(customer.invoice_settings?.default_payment_method, "pm_");
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sourceEnvFile = requiredFile(args, "--source-env-file");
  const destinationEnvFile = path.resolve(
    ROOT,
    argValue(args, "--destination-env-file") || ".env.local"
  );
  if (!fs.existsSync(destinationEnvFile)) throw new Error("The destination environment file is missing.");
  const inventoryFile = requiredFile(args, "--inventory");
  const mappingFile = requiredFile(args, "--mapping");

  const sourceEnv = environment(sourceEnvFile);
  const destinationEnv = environment(destinationEnvFile);
  const expectedSourceAccount = String(argValue(args, "--source-account") ?? "");
  const expectedDestinationAccount = String(destinationEnv.BUYER_STRIPE_ACCOUNT_ID ?? "");
  if (!expectedSourceAccount.startsWith("acct_")) throw new Error("Pass --source-account.");
  if (!expectedDestinationAccount.startsWith("acct_")) {
    throw new Error("BUYER_STRIPE_ACCOUNT_ID is missing from the destination environment.");
  }
  if (expectedSourceAccount === expectedDestinationAccount) {
    throw new Error("Source and destination Stripe accounts must be different.");
  }

  const inventory = parseCsv(fs.readFileSync(inventoryFile, "utf8")).filter(
    (row) => row.migration_action === "migrate" && row.status === "active"
  );
  const mapping = parseCsv(fs.readFileSync(mappingFile, "utf8"));
  if (inventory.length === 0) throw new Error("The source inventory has no active subscriptions.");

  const mappingByCustomer = new Map();
  for (const row of mapping) {
    if (row.customer_id_old !== row.customer_id_new) {
      throw new Error("Stripe changed a copied customer ID unexpectedly.");
    }
    if (!row.customer_id_old?.startsWith("cus_") || !row.source_id_old?.startsWith("pm_") || !row.source_id_new?.startsWith("pm_")) {
      throw new Error("The mapping contains an unsupported customer or payment-method type.");
    }
    if (mappingByCustomer.has(row.customer_id_old)) {
      throw new Error("The mapping contains multiple payment methods for one customer; review manually.");
    }
    mappingByCustomer.set(row.customer_id_old, row);
  }

  const inventoryCustomers = new Set(inventory.map((row) => row.customer_id));
  if (inventoryCustomers.size !== inventory.length || mappingByCustomer.size !== inventoryCustomers.size) {
    throw new Error("Inventory and payment mapping counts do not match one-to-one.");
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

  const changes = [];
  let alreadyConfigured = 0;
  for (const row of inventory) {
    const copied = mappingByCustomer.get(row.customer_id);
    if (!copied) throw new Error("A subscription customer is absent from the copy mapping.");

    const [subscription, destinationCustomer, destinationPaymentMethod] = await Promise.all([
      sourceStripe.subscriptions.retrieve(row.source_subscription_id),
      destinationStripe.customers.retrieve(row.customer_id),
      destinationStripe.paymentMethods.retrieve(copied.source_id_new),
    ]);
    if (subscription.status !== "active" || objectId(subscription.customer, "cus_") !== row.customer_id) {
      throw new Error("A source subscription changed after the inventory was generated.");
    }
    const sourceDefault = await effectiveSourceDefault(sourceStripe, subscription, row.customer_id);
    if (sourceDefault !== copied.source_id_old) {
      throw new Error("A copied payment method is not the source subscription's effective default.");
    }
    if (!destinationCustomer || destinationCustomer.deleted) {
      throw new Error("A destination customer is missing or deleted.");
    }
    if (objectId(destinationPaymentMethod.customer, "cus_") !== row.customer_id) {
      throw new Error("A copied payment method is not attached to its mapped destination customer.");
    }

    const currentDefault = objectId(
      destinationCustomer.invoice_settings?.default_payment_method,
      "pm_"
    );
    if (currentDefault === copied.source_id_new) {
      alreadyConfigured += 1;
    } else if (currentDefault) {
      throw new Error("A destination customer already has a different default payment method.");
    } else {
      changes.push({ customer: row.customer_id, paymentMethod: copied.source_id_new });
    }
  }

  console.log(`Validated ${inventory.length} copied customers and payment methods.`);
  console.log(`Already configured: ${alreadyConfigured}; defaults to set: ${changes.length}.`);
  if (!apply) {
    console.log("Plan only. Re-run with --apply after reviewing this result.");
    return;
  }

  for (const change of changes) {
    await destinationStripe.customers.update(change.customer, {
      invoice_settings: { default_payment_method: change.paymentMethod },
    });
  }

  for (const change of changes) {
    const customer = await destinationStripe.customers.retrieve(change.customer);
    if (
      !customer ||
      customer.deleted ||
      objectId(customer.invoice_settings?.default_payment_method, "pm_") !== change.paymentMethod
    ) {
      throw new Error("Stripe did not persist a destination default payment method.");
    }
  }
  console.log(`Applied and verified ${changes.length} destination customer defaults.`);
  console.log("No charges or subscriptions were created, changed, or canceled.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
