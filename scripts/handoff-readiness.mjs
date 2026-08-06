// Read-only ResearchMatch handoff audit. It never prints secret values and never
// writes to Supabase, Stripe, Vercel, or the local repository.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const argv = process.argv.slice(2);
const live = argv.includes("--live");
const expectLive = argv.includes("--expect-live");
const noEnvFile = argv.includes("--no-env-file");
const envFlagIndex = argv.indexOf("--env-file");
const envFile = path.resolve(
  ROOT,
  envFlagIndex >= 0 && argv[envFlagIndex + 1] ? argv[envFlagIndex + 1] : ".env.local"
);

let failures = 0;
let warnings = 0;

function line(symbol, message) {
  console.log(`${symbol} ${message}`);
}

function pass(message) {
  line("✓", message);
}

function warn(message) {
  warnings += 1;
  line("⚠", message);
}

function fail(message) {
  failures += 1;
  line("✗", message);
}

function section(title) {
  console.log(`\n${title}`);
}

function parseDotenv(source) {
  const values = {};
  for (const originalLine of source.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;
    const key = withoutExport.slice(0, equals).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(equals + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadLocalEnvironment() {
  if (!fs.existsSync(envFile)) {
    warn(`${path.relative(ROOT, envFile)} is missing; copy .env.example to .env.local before running locally`);
    return {};
  }
  const values = parseDotenv(fs.readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value;
  }
  pass(`${path.relative(ROOT, envFile)} loaded (${Object.keys(values).length} names; values hidden)`);
  return values;
}

function hasValue(key) {
  return typeof process.env[key] === "string" && process.env[key].trim().length > 0;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function trackedFiles() {
  return runGit(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function walkTextFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTextFiles(absolute));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|mjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function referencedEnvironmentNames() {
  const files = [
    ...walkTextFiles(path.join(ROOT, "src")),
    ...walkTextFiles(path.join(ROOT, "scripts")),
    path.join(ROOT, "next.config.ts"),
  ].filter(fs.existsSync);
  const names = new Set();
  const direct = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
  const requiredSetting = /requiredServerSetting\(\s*["']([A-Z][A-Z0-9_]*)["']/g;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(direct)) names.add(match[1] ?? match[2]);
    for (const match of source.matchAll(requiredSetting)) names.add(match[1]);
  }
  return names;
}

function secretMarkersInTrackedFiles() {
  const patterns = [
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\brk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\bwhsec_[A-Za-z0-9]{16,}\b/,
    /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
    /\bgsk_[A-Za-z0-9]{16,}\b/,
    /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  ];
  const matches = [];
  for (const relative of trackedFiles()) {
    const absolute = path.join(ROOT, relative);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 1_500_000) continue;
    const source = fs.readFileSync(absolute);
    if (source.includes(0)) continue;
    const text = source.toString("utf8");
    if (patterns.some((pattern) => pattern.test(text))) matches.push(relative);
  }
  return matches;
}

function stripeMode() {
  const secret = process.env.STRIPE_SECRET_KEY ?? "";
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const secretMode = secret.startsWith("sk_live_")
    ? "live"
    : secret.startsWith("sk_test_")
      ? "test"
      : "unknown";
  const publishableMode = publishable.startsWith("pk_live_")
    ? "live"
    : publishable.startsWith("pk_test_")
      ? "test"
      : "unknown";
  return { secretMode, publishableMode };
}

function planForPrice(priceId) {
  if (!priceId) return null;
  const values = (key) =>
    (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const sets = {
    weekly: new Set([
      ...values("STRIPE_PRICE_WEEKLY"),
      ...values("NEXT_PUBLIC_STRIPE_PRICE_WEEKLY"),
      ...values("STRIPE_LEGACY_WEEKLY_PRICE_IDS"),
    ]),
    semester: new Set([
      ...values("STRIPE_PRICE_SEMESTER"),
      ...values("NEXT_PUBLIC_STRIPE_PRICE_SEMESTER"),
      ...values("STRIPE_LEGACY_SEMESTER_PRICE_IDS"),
    ]),
    lifetime: new Set([
      ...values("STRIPE_PRICE_LIFETIME"),
      ...values("NEXT_PUBLIC_STRIPE_PRICE_LIFETIME"),
      ...values("STRIPE_LEGACY_LIFETIME_PRICE_IDS"),
    ]),
  };
  return Object.entries(sets).find(([, ids]) => ids.has(priceId))?.[0] ?? null;
}

async function exactTableCount(supabase, table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function authUserCount(supabase) {
  const perPage = 1_000;
  let page = 1;
  let total = 0;
  while (page <= 100) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Auth user count failed: ${error.message}`);
    const count = data.users.length;
    total += count;
    if (count < perPage) return total;
    page += 1;
  }
  throw new Error("Auth user count exceeded the 100-page safety limit");
}

async function profilePlanCounts(supabase) {
  const counts = {};
  const pageSize = 1_000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await supabase
      .from("profiles")
      .select("plan_type")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Profile plan summary failed: ${error.message}`);
    for (const profile of data ?? []) {
      const plan = profile.plan_type ?? "(null)";
      counts[plan] = (counts[plan] ?? 0) + 1;
    }
    if ((data?.length ?? 0) < pageSize) return counts;
  }
  throw new Error("Profile summary exceeded the 100,000-row safety limit");
}

async function runLiveChecks() {
  section("Live read-only checks");
  const { createClient } = await import("@supabase/supabase-js");
  const { default: Stripe } = await import("stripe");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-02-25.clover",
  });

  const [users, profiles, searches, stripeEvents, buckets, plans] = await Promise.all([
    authUserCount(supabase),
    exactTableCount(supabase, "profiles"),
    exactTableCount(supabase, "search_logs"),
    exactTableCount(supabase, "processed_stripe_events"),
    supabase.storage.listBuckets(),
    profilePlanCounts(supabase),
  ]);
  if (buckets.error) throw new Error(`Storage bucket check failed: ${buckets.error.message}`);
  if (users === profiles) pass(`Supabase Auth users and profiles match (${users})`);
  else fail(`Supabase Auth users (${users}) and profiles (${profiles}) do not match`);
  pass(`Supabase has ${searches} search logs, ${stripeEvents} processed Stripe events, and ${buckets.data.length} Storage buckets`);
  line("·", `Profile plans: ${Object.entries(plans).map(([name, count]) => `${name} ${count}`).join(", ")}`);

  const { data: affiliates, error: affiliateError } = await supabase
    .from("affiliates")
    .select("id, name, code, stripe_promotion_code_id, commission_rate, status")
    .order("created_at", { ascending: true });
  if (affiliateError) throw new Error(`Affiliate check failed: ${affiliateError.message}`);
  const { data: commissions, error: commissionError } = await supabase
    .from("commissions")
    .select("affiliate_id, amount_cents, currency, status");
  if (commissionError) throw new Error(`Commission check failed: ${commissionError.message}`);
  const payoutCount = await exactTableCount(supabase, "payouts");
  for (const affiliate of affiliates ?? []) {
    const rows = (commissions ?? []).filter((row) => row.affiliate_id === affiliate.id);
    const sum = (status) =>
      rows.filter((row) => row.status === status).reduce((total, row) => total + (row.amount_cents ?? 0), 0);
    line(
      "·",
      `${affiliate.name} [${affiliate.code}] ${(Number(affiliate.commission_rate) * 100).toFixed(0)}%: pending $${(sum("pending") / 100).toFixed(2)}, paid $${(sum("paid") / 100).toFixed(2)}, void $${(sum("void") / 100).toFixed(2)}`
    );
    if (affiliate.status === "active" && affiliate.stripe_promotion_code_id) {
      const promotion = await stripe.promotionCodes.retrieve(affiliate.stripe_promotion_code_id);
      if (promotion.active) pass(`Stripe promotion code ${affiliate.code} is active`);
      else fail(`Stripe promotion code ${affiliate.code} is inactive`);
    }
  }
  pass(`Affiliate payout ledger contains ${payoutCount} payout record${payoutCount === 1 ? "" : "s"}`);

  const subscriptionStatuses = {};
  const activePlans = {};
  let activeSubscriptions = 0;
  let activeWithoutUserId = 0;
  let activeUnknownPrices = 0;
  for await (const subscription of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    subscriptionStatuses[subscription.status] = (subscriptionStatuses[subscription.status] ?? 0) + 1;
    if (subscription.status !== "active") continue;
    activeSubscriptions += 1;
    if (!subscription.metadata?.userId) activeWithoutUserId += 1;
    const priceId = subscription.items.data[0]?.price.id;
    const plan = planForPrice(priceId);
    if (!plan) activeUnknownPrices += 1;
    else activePlans[plan] = (activePlans[plan] ?? 0) + 1;
  }
  pass(`Stripe subscriptions: ${Object.entries(subscriptionStatuses).map(([status, count]) => `${status} ${count}`).join(", ") || "none"}`);
  line("·", `Active plan mapping: ${Object.entries(activePlans).map(([plan, count]) => `${plan} ${count}`).join(", ") || "none"}`);
  if (activeUnknownPrices === 0) pass("Every active Stripe subscription uses a configured current or legacy price");
  else fail(`${activeUnknownPrices} active Stripe subscription${activeUnknownPrices === 1 ? " uses" : "s use"} an unmapped price`);
  if (activeWithoutUserId > 0) {
    warn(`${activeWithoutUserId} of ${activeSubscriptions} active subscriptions lack metadata.userId; preserve or repair user mapping during Stripe migration`);
  } else {
    pass("Every active Stripe subscription has metadata.userId");
  }

  const requiredEvents = new Set([
    "checkout.session.completed",
    "customer.subscription.deleted",
    "customer.subscription.updated",
    "invoice.payment_failed",
    "invoice.paid",
    "charge.refunded",
    "charge.dispute.created",
  ]);
  const webhooks = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = webhooks.data.find((item) => {
    try {
      return new URL(item.url).pathname === "/api/webhooks/stripe";
    } catch {
      return false;
    }
  });
  if (!endpoint || endpoint.status !== "enabled") {
    fail("No enabled Stripe webhook ends in /api/webhooks/stripe");
  } else {
    const missing = [...requiredEvents].filter(
      (event) => !endpoint.enabled_events.includes("*") && !endpoint.enabled_events.includes(event)
    );
    if (missing.length === 0) pass("Stripe webhook is enabled for every event handled by the code");
    else fail(`Stripe webhook is missing events: ${missing.join(", ")}`);
  }
}

console.log("ResearchMatch handoff readiness");
console.log("Secret values are never printed. No external data is changed.");

section("Repository and environment");
if (noEnvFile) pass("Using the environment injected by Vercel; local dotenv loading is disabled");
else loadLocalEnvironment();

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 22) pass(`Node.js ${process.versions.node} is supported`);
else fail(`Node.js ${process.versions.node} is too old; install Node.js 22 or newer`);

for (const relative of [
  "package-lock.json",
  ".env.example",
  "TRANSFER.md",
  "handoff/README.md",
  "handoff/BUYER-QUICKSTART.md",
  "handoff/setup/index.html",
  "scripts/buyer-setup.mjs",
  "scripts/buyer-stripe-bootstrap.mjs",
  "scripts/buyer-vercel-sync.mjs",
  "migrations/README.md",
  "migrations/00000000_core_schema.sql",
  "migrations/20260803214340_affiliate_commission_hardening.sql",
]) {
  if (fs.existsSync(path.join(ROOT, relative))) pass(`${relative} is present`);
  else fail(`${relative} is missing`);
}

try {
  const branch = runGit(["branch", "--show-current"]);
  if (branch === "main") pass("Git branch is main");
  else warn(`Git branch is ${branch || "detached"}; transfer the verified main branch`);
  const dirty = runGit(["status", "--porcelain"]);
  if (!dirty) pass("Git working tree is clean");
  else warn("Git working tree has uncommitted changes");
  const origin = runGit(["remote", "get-url", "origin"]);
  if (/github\.com[:/]jacekimmy\/research-match(?:\.git)?$/i.test(origin)) pass("Git origin is the ResearchMatch repository");
  else warn("Git origin does not match the audited ResearchMatch repository");
  try {
    runGit(["ls-files", "--error-unmatch", ".env.local"]);
    fail(".env.local is tracked by Git");
  } catch {
    pass(".env.local is not tracked by Git");
  }
  const exposed = secretMarkersInTrackedFiles();
  if (exposed.length === 0) pass("No common live-secret pattern was found in tracked files");
  else fail(`Possible secrets found in tracked files: ${exposed.join(", ")}`);
} catch (error) {
  fail(`Git check failed: ${error.message.split("\n")[0]}`);
}

const exampleValues = parseDotenv(fs.readFileSync(path.join(ROOT, ".env.example"), "utf8"));
const documented = new Set(Object.keys(exampleValues));
const automatic = new Set(["NODE_ENV", "VERCEL_PROJECT_PRODUCTION_URL"]);
const undocumented = [...referencedEnvironmentNames()].filter(
  (name) => !documented.has(name) && !automatic.has(name)
);
if (undocumented.length === 0) pass(".env.example documents every environment name referenced by the code");
else fail(`.env.example is missing: ${undocumented.sort().join(", ")}`);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PRICE_WEEKLY",
  "NEXT_PUBLIC_STRIPE_PRICE_SEMESTER",
  "NEXT_PUBLIC_STRIPE_PRICE_LIFETIME",
  "STRIPE_PRICE_WEEKLY",
  "STRIPE_PRICE_SEMESTER",
  "STRIPE_PRICE_LIFETIME",
];
const missingRequired = required.filter((key) => !hasValue(key));
if (missingRequired.length === 0) pass("All core runtime environment variables are present");
else fail(`Missing core environment variables: ${missingRequired.join(", ")}`);

const recommended = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_ADMIN_EMAILS",
  "NEXT_PUBLIC_OPENALEX_MAILTO",
  "CANONICAL_REDIRECT_HOSTS",
  "RATE_LIMIT_SECRET",
  "ADMIN_EMAILS",
];
const missingRecommended = recommended.filter((key) => !hasValue(key));
if (missingRecommended.length === 0) pass("All ownership and operations settings are explicit");
else warn(`Recommended ownership settings still use defaults or are blank: ${missingRecommended.join(", ")}`);

const optionalGroups = [
  ["Anthropic preferred AI provider", ["ANTHROPIC_API_KEY"]],
  ["Serper email discovery", ["SERPER_API_KEY"]],
  ["creator and Buddy Pass setup", ["STRIPE_AFFILIATE_COUPON_ID", "STRIPE_BUDDY_PASS_COUPON_ID"]],
  ["PostHog analytics", ["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_KEY"]],
];
for (const [label, keys] of optionalGroups) {
  if (!keys.some(hasValue)) line("·", `${label} is not explicitly configured (optional)`);
}

for (const suffix of ["WEEKLY", "SEMESTER", "LIFETIME"]) {
  const publicValue = process.env[`NEXT_PUBLIC_STRIPE_PRICE_${suffix}`];
  const serverValue = process.env[`STRIPE_PRICE_${suffix}`];
  if (publicValue && serverValue && publicValue === serverValue) pass(`${suffix.toLowerCase()} Stripe price pair matches`);
  else fail(`${suffix.toLowerCase()} Stripe public/server price pair is missing or mismatched`);
}

const mode = stripeMode();
if (mode.secretMode === mode.publishableMode && mode.secretMode !== "unknown") {
  pass(`Stripe secret and publishable keys are both ${mode.secretMode} mode`);
} else {
  fail("Stripe secret and publishable key modes do not match or cannot be identified");
}
if (expectLive && mode.secretMode !== "live") fail("Production audit expected Stripe live-mode keys");

if (hasValue("NEXT_PUBLIC_SITE_URL")) {
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL);
    if (expectLive && site.protocol !== "https:") fail("Production NEXT_PUBLIC_SITE_URL must use HTTPS");
    else pass("NEXT_PUBLIC_SITE_URL is a valid URL");
  } catch {
    fail("NEXT_PUBLIC_SITE_URL is not a valid absolute URL");
  }
}

if (live) {
  if (missingRequired.length > 0) {
    fail("Live checks skipped because core environment variables are missing");
  } else {
    try {
      await runLiveChecks();
    } catch (error) {
      fail(`Live check failed: ${error.message.split("\n")[0]}`);
    }
  }
}

section("Result");
if (failures === 0) {
  pass(`Ready${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`);
} else {
  line("✗", `${failures} blocking issue${failures === 1 ? "" : "s"}; ${warnings} warning${warnings === 1 ? "" : "s"}`);
}
process.exitCode = failures === 0 ? 0 : 1;
