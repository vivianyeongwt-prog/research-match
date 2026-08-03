import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("transfer contract", () => {
  it("keeps the greenfield search_logs primary key compatible with production", () => {
    const schema = readFileSync(join(root, "migrations/00000000_core_schema.sql"), "utf8");
    const block = schema.match(/create table if not exists public\.search_logs \(([\s\S]*?)\n\);/)?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
    expect(block).not.toMatch(/id bigint|identity/i);
  });

  it("provides an additive upgrade for tables missing from existing production", () => {
    const upgrade = readFileSync(
      join(root, "migrations/20260721_existing_production_upgrade.sql"),
      "utf8"
    );

    expect(upgrade).toContain("create table if not exists public.pdf_downloads");
    expect(upgrade).toContain("create table if not exists public.professors");
    expect(upgrade).toContain("add column if not exists framework_used");
    expect(upgrade).not.toMatch(/\b(drop table|truncate|delete from)\b/i);
  });

  it("keeps every server-side sale-readiness RPC in the migration set", () => {
    const saleMigration = readFileSync(join(root, "migrations/20260720_sale_readiness.sql"), "utf8");
    const affiliateMigration = readFileSync(join(root, "migrations/add_affiliate_program.sql"), "utf8");
    for (const name of [
      "consume_api_usage",
      "release_api_usage",
      "consume_summary_quota",
      "release_summary_quota",
      "record_buddy_pass_reward",
      "redeem_promo_code",
    ]) {
      expect(saleMigration).toContain(`function public.${name}(`);
    }
    expect(affiliateMigration.toLowerCase()).toContain("function public.claim_stripe_event(");
  });

  it("hardens referral rewards against direct calls and duplicate counting", () => {
    const hardening = readFileSync(
      join(root, "migrations/20260803205117_referral_system_hardening.sql"),
      "utf8"
    ).toLowerCase();
    const affiliateMigration = readFileSync(
      join(root, "migrations/add_affiliate_program.sql"),
      "utf8"
    ).toLowerCase();
    const reversalLockOrder = readFileSync(
      join(root, "migrations/20260803210704_referral_reversal_lock_order.sql"),
      "utf8"
    ).toLowerCase();

    expect(hardening).toContain("buddy_pass_one_reward_per_user_unique");
    expect(hardening).toContain("referral code does not belong to referrer");
    expect(hardening).toContain("function public.void_buddy_pass_rewards(");
    expect(hardening).toContain(
      "revoke all on function public.grant_buddy_pass_week(uuid, integer) from public, anon, authenticated"
    );
    expect(hardening).toContain("stripe_checkout_session_id");
    expect(affiliateMigration).toContain("referrals_checkout_session_unique");
    expect(reversalLockOrder).toContain("order by referrer_id, id");
    expect(reversalLockOrder).toContain("and status = 'rewarded'");
  });

  it("warns against loading production data into a pre-created greenfield schema", () => {
    const runbook = readFileSync(join(root, "TRANSFER.md"), "utf8");
    expect(runbook).toContain("Do **not** run `00000000_core_schema.sql` first");
    expect(runbook).toContain("production `search_logs.id` values are\nUUIDs");
    expect(runbook).toContain("Never use 17,621 as an expected final count");
  });

  it("documents fail-closed legacy Stripe prices and non-destructive financial cleanup", () => {
    const runbook = readFileSync(join(root, "TRANSFER.md"), "utf8");
    const envExample = readFileSync(join(root, ".env.example"), "utf8");
    expect(runbook).toContain("Unknown prices intentionally grant nothing");
    expect(runbook).toContain("never merges or deletes financial history automatically");
    for (const key of [
      "STRIPE_LEGACY_WEEKLY_PRICE_IDS",
      "STRIPE_LEGACY_SEMESTER_PRICE_IDS",
      "STRIPE_LEGACY_LIFETIME_PRICE_IDS",
    ]) {
      expect(envExample).toContain(`${key}=`);
    }
  });

  it("ships a migration definition for every table and RPC used by application source", () => {
    const source = filesUnder(join(root, "src"))
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const sql = filesUnder(join(root, "migrations"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .toLowerCase();

    const tables = new Set([...source.matchAll(/\.from\("([a-z0-9_]+)"\)/gi)].map((match) => match[1]));
    const functions = new Set([...source.matchAll(/\.rpc\("([a-z0-9_]+)"/gi)].map((match) => match[1]));

    for (const table of tables) {
      expect(sql, `migration set is missing table ${table}`).toContain(`public.${table.toLowerCase()}`);
    }
    for (const name of functions) {
      expect(sql, `migration set is missing RPC ${name}`).toMatch(
        new RegExp(`function\\s+public\\.${name.toLowerCase()}\\s*\\(`)
      );
    }
  });
});
