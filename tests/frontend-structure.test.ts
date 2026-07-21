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

  it("associates visible search labels with their inputs", () => {
    const landingPage = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    const searchForm = readFileSync(join(root, "src/components/ResearchSearchForm.tsx"), "utf8");

    expect(landingPage).toContain('htmlFor="landing-research-interest"');
    expect(landingPage).toContain('id="landing-research-interest"');
    expect(landingPage).toContain('htmlFor="landing-university"');
    expect(landingPage).toContain('id="landing-university"');
    expect(searchForm).toContain('htmlFor={`${fieldIdPrefix}-research-interest`}');
    expect(searchForm).toContain('id={`${fieldIdPrefix}-research-interest`}');
    expect(searchForm).toContain('htmlFor={`${fieldIdPrefix}-professor-name`}');
    expect(searchForm).toContain('id={`${fieldIdPrefix}-professor-name`}');
  });
});
