import crypto from "node:crypto";

const STRIPE_KEY_MODES = {
  publishable: ["pk_live_", "pk_test_"],
  secret: ["sk_live_", "sk_test_"],
};

export const BUYER_SETUP_FIELDS = Object.freeze([
  {
    id: "siteUrl",
    group: "identity",
    label: "Website address",
    description: "The public ResearchMatch address used in links and redirects.",
    placeholder: "https://researchmatch.site",
    envNames: ["NEXT_PUBLIC_SITE_URL"],
    level: "recommended",
    kind: "url",
  },
  {
    id: "supportEmail",
    group: "identity",
    label: "Support email",
    description: "Where customer questions should go after the handoff.",
    placeholder: "support@example.com",
    envNames: ["NEXT_PUBLIC_SUPPORT_EMAIL"],
    level: "recommended",
    kind: "email",
  },
  {
    id: "adminEmails",
    group: "identity",
    label: "Admin email",
    description: "One address, or a comma-separated list, allowed to use admin tools.",
    placeholder: "owner@example.com",
    envNames: ["NEXT_PUBLIC_ADMIN_EMAILS", "ADMIN_EMAILS"],
    level: "recommended",
    kind: "emails",
  },
  {
    id: "openAlexEmail",
    group: "identity",
    label: "OpenAlex contact email",
    description: "A real contact address for polite access to the public OpenAlex API.",
    placeholder: "owner@example.com",
    envNames: ["NEXT_PUBLIC_OPENALEX_MAILTO"],
    level: "recommended",
    kind: "email",
  },
  {
    id: "canonicalHosts",
    group: "identity",
    label: "Allowed website hosts",
    description: "Comma-separated domains that may redirect to the canonical site.",
    placeholder: "researchmatch.site,www.researchmatch.site",
    envNames: ["CANONICAL_REDIRECT_HOSTS"],
    level: "recommended",
    kind: "csv",
    advanced: true,
  },
  {
    id: "supabaseUrl",
    group: "supabase",
    label: "Project URL",
    description: "From Supabase Project Settings → API.",
    placeholder: "https://project-ref.supabase.co",
    envNames: ["NEXT_PUBLIC_SUPABASE_URL"],
    level: "required",
    kind: "supabase-url",
    helpUrl: "https://supabase.com/dashboard/project/_/settings/api",
  },
  {
    id: "supabasePublishableKey",
    group: "supabase",
    label: "Publishable key",
    description: "The browser-safe publishable key (legacy anon keys also work).",
    placeholder: "sb_publishable_… or eyJ…",
    envNames: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    level: "required",
    kind: "supabase-publishable",
    secret: true,
    helpUrl: "https://supabase.com/dashboard/project/_/settings/api-keys",
  },
  {
    id: "supabaseSecretKey",
    group: "supabase",
    label: "Server secret key",
    description: "The server-only secret/service-role key. Never put it in a public variable.",
    placeholder: "sb_secret_… or eyJ…",
    envNames: ["SUPABASE_SERVICE_ROLE_KEY"],
    level: "required",
    kind: "supabase-secret",
    secret: true,
    helpUrl: "https://supabase.com/dashboard/project/_/settings/api-keys",
  },
  {
    id: "stripeAccountId",
    group: "stripe",
    label: "Buyer Stripe account ID",
    description: "A safety check that prevents setup from changing the seller's unrelated Stripe account.",
    placeholder: "acct_…",
    envNames: ["BUYER_STRIPE_ACCOUNT_ID"],
    level: "required",
    kind: "stripe-account",
    localOnly: true,
    helpUrl: "https://dashboard.stripe.com/settings/account",
  },
  {
    id: "stripePublishableKey",
    group: "stripe",
    label: "Publishable key",
    description: "Use the buyer account's live key for production.",
    placeholder: "pk_live_…",
    envNames: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    level: "required",
    kind: "stripe-publishable",
    secret: true,
    helpUrl: "https://dashboard.stripe.com/apikeys",
  },
  {
    id: "stripeSecretKey",
    group: "stripe",
    label: "Secret key",
    description: "The matching buyer-account server key.",
    placeholder: "sk_live_…",
    envNames: ["STRIPE_SECRET_KEY"],
    level: "required",
    kind: "stripe-secret",
    secret: true,
    helpUrl: "https://dashboard.stripe.com/apikeys",
  },
  {
    id: "stripeWebhookSecret",
    group: "stripe",
    label: "Webhook signing secret",
    description: "Create this for the /api/webhooks/stripe production endpoint.",
    placeholder: "whsec_…",
    envNames: ["STRIPE_WEBHOOK_SECRET"],
    level: "required",
    kind: "stripe-webhook",
    secret: true,
    helpUrl: "https://dashboard.stripe.com/webhooks",
  },
  {
    id: "stripeWebhookUrl",
    group: "stripe",
    label: "Webhook endpoint URL",
    description: "Optional stable deployment URL. Defaults to the main website's /api/webhooks/stripe path.",
    placeholder: "https://your-project.vercel.app/api/webhooks/stripe",
    envNames: ["STRIPE_WEBHOOK_URL"],
    level: "optional",
    kind: "url",
    advanced: true,
    helpUrl: "https://dashboard.stripe.com/webhooks",
  },
  {
    id: "stripeWeeklyPrice",
    group: "stripe",
    label: "$7 weekly price",
    description: "Leave blank if using the automatic Stripe setup; otherwise paste one price ID here.",
    placeholder: "price_…",
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_WEEKLY", "STRIPE_PRICE_WEEKLY"],
    level: "required",
    kind: "stripe-price",
    helpUrl: "https://dashboard.stripe.com/products",
  },
  {
    id: "stripeSemesterPrice",
    group: "stripe",
    label: "$29 four-month price",
    description: "Automatic Stripe setup creates this recurring four-month price for you.",
    placeholder: "price_…",
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_SEMESTER", "STRIPE_PRICE_SEMESTER"],
    level: "required",
    kind: "stripe-price",
    helpUrl: "https://dashboard.stripe.com/products",
  },
  {
    id: "stripeLifetimePrice",
    group: "stripe",
    label: "$59 lifetime price",
    description: "Automatic Stripe setup creates this one-time price for you.",
    placeholder: "price_…",
    envNames: ["NEXT_PUBLIC_STRIPE_PRICE_LIFETIME", "STRIPE_PRICE_LIFETIME"],
    level: "required",
    kind: "stripe-price",
    helpUrl: "https://dashboard.stripe.com/products",
  },
  {
    id: "stripeLegacyWeeklyPrices",
    group: "stripe",
    label: "Old weekly prices",
    description: "Source-account price IDs retained while migrated subscriptions finish moving.",
    placeholder: "price_old1,price_old2",
    envNames: ["STRIPE_LEGACY_WEEKLY_PRICE_IDS"],
    level: "optional",
    kind: "stripe-prices",
    advanced: true,
  },
  {
    id: "stripeLegacySemesterPrices",
    group: "stripe",
    label: "Old four-month prices",
    description: "Source-account four-month IDs retained during the migration window.",
    placeholder: "price_old1,price_old2",
    envNames: ["STRIPE_LEGACY_SEMESTER_PRICE_IDS"],
    level: "optional",
    kind: "stripe-prices",
    advanced: true,
  },
  {
    id: "stripeLegacyLifetimePrices",
    group: "stripe",
    label: "Old lifetime prices",
    description: "Source-account lifetime IDs retained for historical webhook safety.",
    placeholder: "price_old1,price_old2",
    envNames: ["STRIPE_LEGACY_LIFETIME_PRICE_IDS"],
    level: "optional",
    kind: "stripe-prices",
    advanced: true,
  },
  {
    id: "buddyCoupon",
    group: "stripe",
    label: "Buddy Pass coupon",
    description: "Optional. The 25% first-payment coupon in the buyer account.",
    placeholder: "research_buddy_pass_25",
    envNames: ["STRIPE_BUDDY_PASS_COUPON_ID"],
    level: "optional",
    kind: "identifier",
    advanced: true,
  },
  {
    id: "affiliateCoupon",
    group: "stripe",
    label: "Creator coupon",
    description: "Optional. The 20% first-payment Oxford PhD coupon in the buyer account.",
    placeholder: "creator_20_once",
    envNames: ["STRIPE_AFFILIATE_COUPON_ID"],
    level: "optional",
    kind: "identifier",
    advanced: true,
  },
  {
    id: "anthropicKey",
    group: "ai",
    label: "Anthropic API key",
    description: "Required for AI search expansion, summaries, and email tools.",
    placeholder: "sk-ant-…",
    envNames: ["ANTHROPIC_API_KEY"],
    level: "required",
    kind: "anthropic-key",
    secret: true,
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "serperKey",
    group: "ai",
    label: "Serper API key",
    description: "Optional enhancement for finding public professor email pages.",
    placeholder: "API key",
    envNames: ["SERPER_API_KEY"],
    level: "optional",
    kind: "token",
    secret: true,
    helpUrl: "https://serper.dev/api-key",
  },
  {
    id: "posthogToken",
    group: "analytics",
    label: "PostHog project token",
    description: "Optional privacy-limited product analytics. Leave blank to keep it off.",
    placeholder: "phc_…",
    envNames: ["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_KEY"],
    level: "optional",
    kind: "token",
    secret: true,
    helpUrl: "https://us.posthog.com/project/settings",
  },
  {
    id: "posthogHost",
    group: "analytics",
    label: "PostHog host",
    description: "Usually the US cloud endpoint already shown here.",
    placeholder: "https://us.i.posthog.com",
    envNames: ["NEXT_PUBLIC_POSTHOG_HOST"],
    level: "optional",
    kind: "url",
    advanced: true,
  },
]);

export const REQUIRED_ENV_NAMES = Object.freeze(
  BUYER_SETUP_FIELDS.filter((field) => field.level === "required").flatMap(
    (field) => field.envNames
  )
);

export const VERCEL_ENV_NAMES = Object.freeze([
  ...new Set(
    BUYER_SETUP_FIELDS.filter((field) => !field.localOnly).flatMap((field) => field.envNames)
  ),
  "RATE_LIMIT_SECRET",
]);

export const SECRET_ENV_NAMES = Object.freeze(
  new Set([
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "SERPER_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "RATE_LIMIT_SECRET",
  ])
);

export function parseDotenv(source = "") {
  const values = {};
  for (const originalLine of source.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equals = body.indexOf("=");
    if (equals <= 0) continue;
    const key = body.slice(0, equals).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    const raw = body.slice(equals + 1).trim();
    let value = raw;
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw.slice(1, -1);
      }
    } else if (raw.startsWith("'") && raw.endsWith("'")) {
      value = raw.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function formatDotenvValue(value) {
  const normalized = String(value ?? "");
  if (!normalized) return "";
  if (/^[A-Za-z0-9_./,:@+%=-]+$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

export function renderEnvironmentFile(templateSource, existingSource, updates = {}) {
  const templateValues = parseDotenv(templateSource);
  const existingValues = parseDotenv(existingSource);
  const merged = { ...templateValues, ...existingValues, ...updates };
  const rendered = templateSource
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*)([A-Z][A-Z0-9_]*)(\s*)=/);
      if (!match) return line;
      const [, leading, key] = match;
      return `${leading}${key}=${formatDotenvValue(merged[key] ?? "")}`;
    });

  const templateNames = new Set(Object.keys(templateValues));
  const customNames = Object.keys(existingValues).filter((key) => !templateNames.has(key));
  if (customNames.length > 0) {
    rendered.push("", "# Preserved custom variables");
    for (const key of customNames.sort()) {
      rendered.push(`${key}=${formatDotenvValue(merged[key])}`);
    }
  }
  return {
    source: `${rendered.join("\n").replace(/\n+$/, "")}\n`,
    values: merged,
  };
}

function splitCsv(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stripeMode(value, prefixes) {
  return prefixes.find((prefix) => value.startsWith(prefix))?.includes("live")
    ? "live"
    : prefixes.find((prefix) => value.startsWith(prefix))?.includes("test")
      ? "test"
      : null;
}

export function normalizeAndValidateField(field, rawValue) {
  let value = String(rawValue ?? "").trim();
  if (!value) return { value: "", error: null };
  if (field.kind === "csv" || field.kind === "emails" || field.kind === "stripe-prices") {
    value = splitCsv(value).join(",");
  }

  let error = null;
  if (field.kind === "email" && !isEmail(value)) error = "Enter a valid email address.";
  if (field.kind === "emails" && splitCsv(value).some((email) => !isEmail(email))) {
    error = "Enter valid email addresses separated by commas.";
  }
  if (["url", "supabase-url"].includes(field.kind)) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
      if (field.kind === "supabase-url" && url.protocol !== "https:") {
        error = "Supabase project URLs must use HTTPS.";
      }
    } catch {
      error = "Enter a complete http:// or https:// URL.";
    }
  }
  if (
    field.kind === "supabase-publishable" &&
    !value.startsWith("sb_publishable_") &&
    !value.startsWith("eyJ")
  ) {
    error = "Use a Supabase publishable key or legacy anon JWT.";
  }
  if (
    field.kind === "supabase-secret" &&
    !value.startsWith("sb_secret_") &&
    !value.startsWith("eyJ")
  ) {
    error = "Use a Supabase secret key or legacy service-role JWT.";
  }
  if (field.kind === "stripe-publishable" && !stripeMode(value, STRIPE_KEY_MODES.publishable)) {
    error = "Stripe publishable keys begin with pk_live_ or pk_test_.";
  }
  if (field.kind === "stripe-account" && !value.startsWith("acct_")) {
    error = "Stripe account IDs begin with acct_.";
  }
  if (field.kind === "stripe-secret" && !stripeMode(value, STRIPE_KEY_MODES.secret)) {
    error = "Stripe secret keys begin with sk_live_ or sk_test_.";
  }
  if (field.kind === "stripe-webhook" && !value.startsWith("whsec_")) {
    error = "Stripe webhook secrets begin with whsec_.";
  }
  if (field.kind === "stripe-price" && !value.startsWith("price_")) {
    error = "Stripe price IDs begin with price_.";
  }
  if (
    field.kind === "stripe-prices" &&
    splitCsv(value).some((price) => !price.startsWith("price_"))
  ) {
    error = "Every Stripe price ID must begin with price_.";
  }
  if (field.kind === "anthropic-key" && !value.startsWith("sk-ant-")) {
    error = "Anthropic API keys begin with sk-ant-.";
  }
  return { value, error };
}

export function environmentUpdatesFromInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Configuration values must be an object.");
  }
  const fieldsById = new Map(BUYER_SETUP_FIELDS.map((field) => [field.id, field]));
  const unknown = Object.keys(input).filter((id) => !fieldsById.has(id));
  if (unknown.length > 0) throw new Error(`Unknown setup field: ${unknown.join(", ")}`);

  const updates = {};
  const errors = {};
  for (const [id, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== "string") {
      errors[id] = "Enter text only.";
      continue;
    }
    const field = fieldsById.get(id);
    const { value, error } = normalizeAndValidateField(field, rawValue);
    if (!value) continue;
    if (error) {
      errors[id] = error;
      continue;
    }
    for (const envName of field.envNames) updates[envName] = value;
  }
  if (Object.keys(errors).length > 0) {
    const error = new Error("Some fields need attention.");
    error.fieldErrors = errors;
    throw error;
  }
  return updates;
}

export function ensureGeneratedSecrets(values) {
  if (String(values.RATE_LIMIT_SECRET ?? "").trim()) return {};
  return { RATE_LIMIT_SECRET: crypto.randomBytes(32).toString("base64url") };
}

export function configurationStatus(values) {
  const fields = BUYER_SETUP_FIELDS.map((field) => {
    const entries = field.envNames.map((name) => String(values[name] ?? "").trim());
    const present = entries.filter(Boolean);
    const state =
      present.length === 0
        ? "missing"
        : present.length !== entries.length || new Set(entries).size !== 1
          ? "mismatch"
          : "configured";
    return { id: field.id, state };
  });
  const required = fields.filter((status) => {
    return BUYER_SETUP_FIELDS.find((field) => field.id === status.id)?.level === "required";
  });
  return {
    fields,
    requiredConfigured: required.filter((field) => field.state === "configured").length,
    requiredTotal: required.length,
    ready: required.every((field) => field.state === "configured"),
  };
}

export function validateEnvironment(values) {
  const errors = [];
  for (const field of BUYER_SETUP_FIELDS) {
    const entries = field.envNames.map((name) => String(values[name] ?? "").trim());
    if (field.level === "required" && entries.some((value) => !value)) {
      errors.push(`${field.label} is missing.`);
      continue;
    }
    if (entries.filter(Boolean).length > 1 && new Set(entries).size !== 1) {
      errors.push(`${field.label} has mismatched paired values.`);
    }
    if (entries[0]) {
      const validation = normalizeAndValidateField(field, entries[0]);
      if (validation.error) errors.push(`${field.label}: ${validation.error}`);
    }
  }
  const publishableMode = stripeMode(
    String(values.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""),
    STRIPE_KEY_MODES.publishable
  );
  const secretMode = stripeMode(String(values.STRIPE_SECRET_KEY ?? ""), STRIPE_KEY_MODES.secret);
  if (publishableMode && secretMode && publishableMode !== secretMode) {
    errors.push("Stripe publishable and secret keys use different live/test modes.");
  }
  return errors;
}

export function validateProductionEnvironment(values) {
  const errors = [...validateEnvironment(values)];
  try {
    const site = new URL(String(values.NEXT_PUBLIC_SITE_URL ?? ""));
    if (site.protocol !== "https:") errors.push("The production website address must use HTTPS.");
    if (["localhost", "127.0.0.1"].includes(site.hostname)) {
      errors.push("The production website address cannot point to this computer.");
    }
  } catch {
    errors.push("The production website address is missing or invalid.");
  }
  if (!String(values.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_live_")) {
    errors.push("Production requires a live Stripe publishable key.");
  }
  if (!String(values.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_")) {
    errors.push("Production requires a live Stripe secret key.");
  }
  return [...new Set(errors)];
}
