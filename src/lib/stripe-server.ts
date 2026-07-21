import Stripe from "stripe";
import { requiredServerSetting } from "@/lib/server-env";

const STRIPE_API_VERSION = "2026-02-25.clover" as const;

let sharedStripeClient: Stripe | undefined;

export function stripeSecretKey(
  env: Record<string, string | undefined> = process.env
) {
  return requiredServerSetting("STRIPE_SECRET_KEY", env);
}

export function stripeWebhookSecret(
  env: Record<string, string | undefined> = process.env
) {
  return requiredServerSetting("STRIPE_WEBHOOK_SECRET", env);
}

/** Lazily create the server-only Stripe client so imports and builds stay side-effect free. */
export function stripeClient() {
  sharedStripeClient ??= new Stripe(stripeSecretKey(), {
    apiVersion: STRIPE_API_VERSION,
  });
  return sharedStripeClient;
}
