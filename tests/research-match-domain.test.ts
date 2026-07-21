import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dedupeAuthors,
  formatCitations,
  formatInstitutionLocation,
  homeInstitutionFirst,
  lookupAuthorsByIds,
  promoteMatchedInstitution,
  topicRelevanceRank,
  type Author,
} from "../src/lib/research-match-domain";

function author(overrides: Partial<Author> = {}): Author {
  return {
    id: "https://openalex.org/A1",
    display_name: "Ada Researcher",
    orcid: null,
    last_known_institutions: [],
    affiliations: [],
    works_count: 20,
    cited_by_count: 100,
    topics: [],
    ...overrides,
  };
}

describe("Research Match author domain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats US and international institution locations", () => {
    expect(formatInstitutionLocation({
      id: "I1",
      display_name: "Example University",
      country_code: "US",
      geo: { city: "Irvine", region: "California", country: "United States" },
    })).toBe("Example University, Irvine, CA");

    expect(formatInstitutionLocation({
      id: "I2",
      display_name: "Oxford",
      country_code: "GB",
      geo: { city: "Oxford", country: "United Kingdom" },
    })).toBe("Oxford, Oxford, United Kingdom");
  });

  it("puts the most recent, longest-held institution first", () => {
    const value = author({
      last_known_institutions: [
        { id: "old", display_name: "Old", country_code: "US" },
        { id: "home", display_name: "Home", country_code: "US" },
      ],
      affiliations: [
        { institution: { id: "old" }, years: [2018, 2019] },
        { institution: { id: "home" }, years: [2020, 2021, 2022, 2023] },
      ],
    });

    homeInstitutionFirst(value);

    expect(value.last_known_institutions.map((item) => item.id)).toEqual(["home", "old"]);
  });

  it("promotes established matches but does not mislabel thin affiliations", () => {
    const established = author({
      last_known_institutions: [
        { id: "home", display_name: "Home", country_code: "US" },
        { id: "searched", display_name: "Searched", country_code: "US" },
      ],
      affiliations: [
        { institution: { id: "home" }, years: [2024] },
        { institution: { id: "searched" }, years: [2021, 2022, 2023] },
      ],
    });
    expect(promoteMatchedInstitution(established, ["searched"])).toBe(true);
    expect(established.last_known_institutions[0].id).toBe("searched");

    const thin = author({
      last_known_institutions: [
        { id: "searched", display_name: "Searched", country_code: "US" },
        { id: "home", display_name: "Home", country_code: "US" },
      ],
      affiliations: [
        { institution: { id: "searched" }, years: [2021] },
        { institution: { id: "home" }, years: [2022, 2023, 2024] },
      ],
    });
    expect(promoteMatchedInstitution(thin, ["searched"])).toBe(true);
    expect(thin.last_known_institutions[0].id).toBe("home");
  });

  it("removes ghost fragments and keeps distinct ORCID identities", () => {
    const result = dedupeAuthors([
      author({ id: "ghost", works_count: 2, cited_by_count: 0 }),
      author({ id: "rich", orcid: "0000-1", cited_by_count: 200 }),
      author({ id: "namesake", orcid: "0000-2", cited_by_count: 50 }),
    ]);

    expect(result.map((item) => item.id)).toEqual(["rich", "namesake"]);
  });

  it("ranks central topics ahead of incidental topics", () => {
    const specialist = author({ topics: [
      { id: "https://openalex.org/T2", display_name: "Target" },
      { id: "https://openalex.org/T1", display_name: "Related" },
    ] });
    const generalist = author({ topics: [
      { id: "https://openalex.org/T9", display_name: "Other" },
      { id: "https://openalex.org/T8", display_name: "Other" },
      { id: "https://openalex.org/T2", display_name: "Target" },
    ] });

    expect(topicRelevanceRank(specialist, ["T1", "T2"]))
      .toBeLessThan(topicRelevanceRank(generalist, ["T1", "T2"]));
  });

  it("formats citation counts for cards and filters", () => {
    expect(formatCitations(999)).toBe("999");
    expect(formatCitations(1_499)).toBe("1k");
    expect(formatCitations(1_250_000)).toBe("1.3M");
  });

  it("loads an author batch through the shared OpenAlex path", async () => {
    const resultAuthor = author({ id: "https://openalex.org/A1" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ results: [resultAuthor] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupAuthorsByIds(["A1"], [])).resolves.toEqual([resultAuthor]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("filter=ids.openalex:A1");
  });
});
