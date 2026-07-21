import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("frontend structure", () => {
  it("keeps OpenAlex domain rules outside the main page component", () => {
    const page = readFileSync(join(root, "src/app/app/page.tsx"), "utf8");

    expect(page).not.toContain("function dedupeAuthors(");
    expect(page).not.toContain("function promoteMatchedInstitution(");
    expect(page).not.toContain("function oaFetch(");
    expect(page).toContain('from "@/lib/research-match-domain"');
  });

  it("uses one controlled search form for hero and results layouts", () => {
    const page = readFileSync(join(root, "src/app/app/page.tsx"), "utf8");
    const componentUses = page.match(/<ResearchSearchForm\b/g) ?? [];

    expect(componentUses).toHaveLength(2);
    expect(page).toContain("<EmailComposerModal");
    expect(page).toContain("<ResearchAppNav");
    expect(page.split("\n").length).toBeLessThan(2_600);
  });
});
