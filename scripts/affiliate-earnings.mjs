// Shows what you owe each creator: commissions recorded, pending (owe now), and paid.
//
// Usage:
//   node scripts/affiliate-earnings.mjs                 # summary for all affiliates
//   node scripts/affiliate-earnings.mjs --code PARKER   # detail for one creator
//
// This is read-only. It does NOT move money or mark anything paid — pay creators via
// PayPal/Venmo/bank, then mark their commissions paid (status='paid') + log a payout.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && !key.startsWith("#")) process.env[key.trim()] ??= rest.join("=").trim();
  }
} catch {
  console.error("Could not read .env.local at repo root.");
  process.exit(1);
}

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
  }
}
const codeFilter = args.code ? args.code.trim().toUpperCase() : null;

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`${key} is missing from .env.local.`);
    process.exit(1);
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const money = (cents, currency = "usd") =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });

async function main() {
  const { data: affiliates, error } = await supabase
    .from("affiliates")
    .select("id, name, code, payout_email, commission_rate, status")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Could not load affiliates:", error.message);
    process.exit(1);
  }
  if (!affiliates?.length) {
    console.log("No affiliates yet. Create one with scripts/create-affiliate.mjs.");
    return;
  }

  let grandPending = 0;
  let matched = 0;
  for (const a of affiliates) {
    if (codeFilter && a.code !== codeFilter) continue;
    matched += 1;

    const { data: comms, error: commissionError } = await supabase
      .from("commissions")
      .select("amount_cents, currency, status")
      .eq("affiliate_id", a.id);
    if (commissionError) {
      console.error(`Could not load commissions for ${a.code}:`, commissionError.message);
      process.exit(1);
    }
    const { count: payoutCount, error: payoutError } = await supabase
      .from("payouts")
      .select("*", { count: "exact", head: true })
      .eq("affiliate_id", a.id);
    if (payoutError) {
      console.error(`Could not load payouts for ${a.code}:`, payoutError.message);
      process.exit(1);
    }

    const rows = comms ?? [];
    const sum = (s) => rows.filter((c) => c.status === s).reduce((t, c) => t + (c.amount_cents || 0), 0);
    const pending = sum("pending");
    const paid = sum("paid");
    const voided = sum("void");
    grandPending += pending;

    console.log(`\n${a.name}  [${a.code}]  (${a.status}, ${(Number(a.commission_rate) * 100).toFixed(0)}%)`);
    console.log(`  payout to:            ${a.payout_email || "—"}`);
    console.log(`  commissions recorded: ${rows.length}`);
    console.log(`  PENDING (owe now):    ${money(pending)}`);
    console.log(`  already paid:         ${money(paid)}`);
    console.log(`  void/refunded:        ${money(voided)}`);
    console.log(`  payout records:       ${payoutCount ?? 0}`);
  }

  if (codeFilter && matched === 0) {
    console.error(`No affiliate found for code ${codeFilter}.`);
    process.exit(1);
  }

  if (!codeFilter) {
    console.log(`\n────────────\nTOTAL PENDING across all creators: ${money(grandPending)}`);
  }
  console.log("\nRead-only report: no money was moved and no rows were changed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
