// Creates the buyer account's deterministic ResearchMatch billing resources.
// Dry-run by default; --apply creates missing resources but never charges,
// cancels, copies, or modifies a customer or subscription.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  parseDotenv,
  renderEnvironmentFile,
} from "./lib/buyer-setup-config.mjs";
import {
  provisionBuyerStripe,
  RESEARCHMATCH_AFFILIATE_CODE,
} from "./lib/stripe-buyer-bootstrap.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const STRIPE_API_VERSION = "2026-02-25.clover";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function saveEnvironment(envFile, existingSource, updates) {
  const templateSource = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const { source } = renderEnvironmentFile(templateSource, existingSource, updates);
  const backupDirectory = path.join(ROOT, ".handoff-private", "env-backups");
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDirectory, `.env.local.${timestamp()}.backup`);
  fs.writeFileSync(backup, existingSource, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const temporary = `${envFile}.stripe-setup-${process.pid}`;
  fs.writeFileSync(temporary, source, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, envFile);
  try {
    fs.chmodSync(envFile, 0o600);
  } catch {
    // Best-effort on non-POSIX filesystems.
  }
  return path.relative(ROOT, backup);
}

async function relinkAffiliate(env, promotionCodeId, apply) {
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  if (required.some((name) => !String(env[name] ?? "").trim())) {
    return { state: "skipped", message: "Supabase keys are missing; affiliate relink was skipped." };
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: affiliate, error } = await supabase
    .from("affiliates")
    .select("id, code, status, commission_rate, stripe_promotion_code_id")
    .eq("code", RESEARCHMATCH_AFFILIATE_CODE)
    .maybeSingle();
  if (error) throw new Error(`Could not inspect the Oxford affiliate: ${error.message}`);
  if (!affiliate) {
    return { state: "missing", message: "Oxford affiliate row was not found in Supabase." };
  }
  if (affiliate.status !== "active" || Number(affiliate.commission_rate) !== 0.3) {
    throw new Error("The Oxford affiliate row does not have the expected active 30% agreement.");
  }
  if (affiliate.stripe_promotion_code_id === promotionCodeId) {
    return { state: "linked", message: "Oxford affiliate already points to the buyer promotion code." };
  }
  if (!apply) {
    return { state: "planned", message: "Oxford affiliate will be linked to the buyer promotion code." };
  }
  const { data: updated, error: updateError } = await supabase
    .from("affiliates")
    .update({ stripe_promotion_code_id: promotionCodeId })
    .eq("id", affiliate.id)
    .select("id")
    .single();
  if (updateError || !updated) {
    throw new Error(`Could not relink the Oxford affiliate: ${updateError?.message ?? "no row updated"}`);
  }
  return { state: "linked", message: "Oxford affiliate is linked to the buyer promotion code." };
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const envFile = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envFile)) throw new Error(".env.local is missing. Run npm run buyer:setup first.");
  const existingSource = fs.readFileSync(envFile, "utf8");
  const env = { ...process.env, ...parseDotenv(existingSource) };
  const secret = String(env.STRIPE_SECRET_KEY ?? "");
  const publishable = String(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");
  const live = secret.startsWith("sk_live_") && publishable.startsWith("pk_live_");
  const test = secret.startsWith("sk_test_") && publishable.startsWith("pk_test_");
  if (!live && !test) throw new Error("Stripe secret and publishable keys are missing or use different modes.");
  const site = new URL(String(env.NEXT_PUBLIC_SITE_URL ?? ""));
  if (live && (site.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(site.hostname))) {
    throw new Error("Live Stripe setup requires the public HTTPS ResearchMatch website address.");
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  const result = await provisionBuyerStripe(stripe, env, { apply });
  const accountId = result.inspection.account.id;
  console.log(`ResearchMatch Stripe setup for ${accountId} (${live ? "live" : "test"} mode)`);
  if (result.actions.length === 0) console.log("✓ All deterministic Stripe resources already exist.");
  else for (const action of result.actions) console.log(`${apply ? "✓" : "·"} ${action}`);

  let backup = null;
  if (apply) {
    backup = saveEnvironment(envFile, existingSource, result.envUpdates);
    Object.assign(env, result.envUpdates);
  }
  const promotionCodeId = result.inspection.promotionCode?.id ?? null;
  const affiliate = !live
    ? {
        state: "skipped",
        message: "Test-mode setup never changes the transferred production affiliate row.",
      }
    : promotionCodeId
      ? await relinkAffiliate(env, promotionCodeId, apply)
      : {
          state: "planned",
          message: "Oxford affiliate will be relinked after the promotion code is created.",
        };
  console.log(`${affiliate.state === "linked" ? "✓" : "·"} ${affiliate.message}`);

  if (!apply) {
    console.log("No Stripe or Supabase value was changed. Run npm run buyer:stripe:apply when ready.");
    return;
  }
  console.log(`✓ Private environment updated; prior file backed up at ${backup}.`);
  console.log("No customer was charged, copied, canceled, or modified.");
  console.log("Run npm run buyer:setup again, then sync the finished values to Vercel.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
