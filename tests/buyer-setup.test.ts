import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configurationStatus,
  ensureGeneratedSecrets,
  environmentUpdatesFromInput,
  parseDotenv,
  renderEnvironmentFile,
  validateProductionEnvironment,
} from "../scripts/lib/buyer-setup-config.mjs";
import { createBuyerSetupServer } from "../scripts/buyer-setup.mjs";
import {
  syncVercelEnvironment,
  vercelUploadPlan,
} from "../scripts/buyer-vercel-sync.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "researchmatch-buyer-setup-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validEnvironment() {
  return {
    NEXT_PUBLIC_SITE_URL: "https://researchmatch.site",
    BUYER_STRIPE_ACCOUNT_ID: "acct_buyer",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
    ANTHROPIC_API_KEY: "sk-ant-example",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_example",
    STRIPE_SECRET_KEY: "sk_live_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    NEXT_PUBLIC_STRIPE_PRICE_WEEKLY: "price_weekly",
    STRIPE_PRICE_WEEKLY: "price_weekly",
    NEXT_PUBLIC_STRIPE_PRICE_SEMESTER: "price_semester",
    STRIPE_PRICE_SEMESTER: "price_semester",
    NEXT_PUBLIC_STRIPE_PRICE_LIFETIME: "price_lifetime",
    STRIPE_PRICE_LIFETIME: "price_lifetime",
    RATE_LIMIT_SECRET: "rate_limit_example",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buyer setup configuration", () => {
  it("parses quoted values and renders a complete environment without losing custom names", () => {
    const template = [
      "# Contract",
      "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
      "STRIPE_PRICE_WEEKLY=",
      "",
    ].join("\n");
    const existing = [
      'NEXT_PUBLIC_SITE_URL="https://researchmatch.site"',
      "CUSTOM_SETTING='kept value'",
    ].join("\n");
    const rendered = renderEnvironmentFile(template, existing, {
      STRIPE_PRICE_WEEKLY: "price_weekly",
    });

    expect(parseDotenv(rendered.source)).toMatchObject({
      NEXT_PUBLIC_SITE_URL: "https://researchmatch.site",
      STRIPE_PRICE_WEEKLY: "price_weekly",
      CUSTOM_SETTING: "kept value",
    });
    expect(rendered.source).toContain("# Preserved custom variables");
  });

  it("writes paired Stripe and admin settings from one buyer entry", () => {
    const updates = environmentUpdatesFromInput({
      adminEmails: "owner@example.com",
      stripeWeeklyPrice: "price_weekly",
    });
    expect(updates).toMatchObject({
      NEXT_PUBLIC_ADMIN_EMAILS: "owner@example.com",
      ADMIN_EMAILS: "owner@example.com",
      NEXT_PUBLIC_STRIPE_PRICE_WEEKLY: "price_weekly",
      STRIPE_PRICE_WEEKLY: "price_weekly",
    });
  });

  it("rejects malformed keys and reports status without returning values", () => {
    expect(() => environmentUpdatesFromInput({ stripeSecretKey: "wrong" })).toThrow(
      "Some fields need attention"
    );
    const status = configurationStatus(validEnvironment());
    expect(status.ready).toBe(true);
    expect(JSON.stringify(status)).not.toContain("sk_live_example");
  });

  it("generates a stable-length rate-limit secret only when one is missing", () => {
    const generated = ensureGeneratedSecrets({});
    expect(generated.RATE_LIMIT_SECRET).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(ensureGeneratedSecrets({ RATE_LIMIT_SECRET: "existing" })).toEqual({});
  });

  it("blocks test Stripe keys and localhost from the production sync", () => {
    const values = {
      ...validEnvironment(),
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_example",
      STRIPE_SECRET_KEY: "sk_test_example",
    };
    expect(validateProductionEnvironment(values).join("\n")).toMatch(
      /HTTPS|cannot point|live Stripe/
    );
  });

  it("keeps the buyer Stripe account safety ID local instead of uploading it", () => {
    const plan = vercelUploadPlan(validEnvironment());
    expect(plan.some((item) => item.name === "BUYER_STRIPE_ACCOUNT_ID")).toBe(false);
  });
});

describe("local buyer setup server", () => {
  it("requires the private token and never returns submitted secrets", async () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "handoff", "setup"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    for (const name of ["index.html", "app.js", "styles.css"]) {
      writeFileSync(join(root, "handoff", "setup", name), name);
    }
    writeFileSync(
      join(root, ".env.example"),
      readFileSync(join(process.cwd(), ".env.example"), "utf8")
    );
    writeFileSync(
      join(root, "scripts", "handoff-readiness.mjs"),
      'console.log("Secret-safe fixture check");\n'
    );
    const token = "private-test-token";
    const setup = createBuyerSetupServer({ root, token });
    const { port } = await setup.listen();
    const origin = `http://127.0.0.1:${port}`;

    try {
      const rejected = await fetch(`${origin}/api/bootstrap`, {
        headers: { Host: `127.0.0.1:${port}` },
      });
      expect(rejected.status).toBe(403);

      const values = {
        siteUrl: "https://researchmatch.site",
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_browser",
        supabaseSecretKey: "sb_secret_server_private",
        anthropicKey: "sk-ant-private-example",
        stripeAccountId: "acct_buyer",
        stripePublishableKey: "pk_live_browser",
        stripeSecretKey: "sk_live_server_private",
        stripeWebhookSecret: "whsec_private_example",
        stripeWeeklyPrice: "price_weekly",
        stripeSemesterPrice: "price_semester",
        stripeLifetimePrice: "price_lifetime",
      };
      const saved = await fetch(`${origin}/api/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: `127.0.0.1:${port}`,
          Origin: origin,
          "X-Setup-Token": token,
        },
        body: JSON.stringify({ values }),
      });
      expect(saved.status).toBe(200);
      const responseText = await saved.text();
      expect(responseText).not.toContain(values.stripeSecretKey);
      expect(responseText).not.toContain(values.supabaseSecretKey);
      expect(readFileSync(join(root, ".env.local"), "utf8")).toContain(
        values.stripeSecretKey
      );
    } finally {
      await new Promise<void>((resolve) => setup.server.close(() => resolve()));
    }
  });
});

describe("Vercel buyer sync", () => {
  it("passes every value through stdin instead of command arguments", () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, ".vercel"), { recursive: true });
    writeFileSync(
      join(root, ".vercel", "project.json"),
      JSON.stringify({ projectId: "prj_researchmatch" })
    );
    const values = validEnvironment();
    const run = vi.fn(() => ({ status: 0, stdout: "ok", stderr: "" }));
    const result = syncVercelEnvironment({
      values,
      root,
      apply: true,
      run: run as unknown as typeof import("node:child_process").spawnSync,
    });

    expect(result.applied).toBe(vercelUploadPlan(values).length);
    const calls = run.mock.calls as unknown as Array<
      [string, string[], { input: string }]
    >;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, args, options] of calls) {
      expect(args.join(" ")).not.toContain(options.input.trim());
      expect(options.input.endsWith("\n")).toBe(true);
    }
    const secretCall = calls.find(([, args]) => args.includes("STRIPE_SECRET_KEY"));
    expect(secretCall?.[1]).toContain("--sensitive");
  });
});
