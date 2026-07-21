import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { posts } from "../src/app/blog/posts";

const root = process.cwd();

describe("public-site contract", () => {
  it("keeps every internal blog link and related article valid", () => {
    const slugs = new Set(posts.map((post) => post.slug));

    for (const post of posts) {
      expect(slugs.size).toBe(posts.length);
      for (const related of post.relatedSlugs) {
        expect(related).not.toBe(post.slug);
        expect(slugs.has(related), `${post.slug} links to missing related post ${related}`).toBe(true);
      }
      for (const match of post.content.matchAll(/href=["']\/blog\/([^"'#?]+)["']/g)) {
        expect(slugs.has(match[1]), `${post.slug} links to missing blog post ${match[1]}`).toBe(true);
      }
    }
  });

  it("lists every public utility and legal page in the sitemap", () => {
    const sitemap = readFileSync(join(root, "src/app/sitemap.ts"), "utf8");
    for (const path of ["/follow-up", "/privacy", "/terms"]) {
      expect(sitemap).toContain(`\`${"${SITE}"}${path}\``);
    }
  });

  it("gives each legal page its own canonical URL", () => {
    const privacy = readFileSync(join(root, "src/app/privacy/page.tsx"), "utf8");
    const terms = readFileSync(join(root, "src/app/terms/page.tsx"), "utf8");
    expect(privacy).toContain('canonical: "/privacy"');
    expect(terms).toContain('canonical: "/terms"');
  });

  it("never auto-modifies or deletes duplicate financial referral rows", () => {
    const migration = readFileSync(join(root, "migrations/add_affiliate_program.sql"), "utf8");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.referrals/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.commissions/i);
    expect(migration).toMatch(/RAISE\s+EXCEPTION[^;]*manual review/i);
  });

  it("keeps the public search counter read-only and never invents a zero on failure", () => {
    const route = readFileSync(join(root, "src/app/api/stats/route.ts"), "utf8");
    expect(route).not.toContain("allowRequestRate");
    expect(route).toContain('.from("search_logs")');
    expect(route).toContain('error: "stats_unavailable"');
    expect(route).not.toMatch(/catch[^]*searches:\s*0/);
  });
});
