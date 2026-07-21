import { foldName, nameMatches } from "./author-normalize";
import { oaUrl } from "./openalex";

export interface Author {
  id: string;
  display_name: string;
  orcid?: string | null;
  last_known_institutions: Array<{
    id: string;
    display_name: string;
    country_code: string;
    geo?: { city?: string; region?: string; country?: string };
  }>;
  affiliations?: Array<{ institution?: { id?: string }; years?: number[] }>;
  works_count: number;
  cited_by_count: number;
  topics: Array<{ id?: string; display_name: string }>;
}

export interface OpenAlexInstitutionRef {
  id?: string;
}

export interface OpenAlexAuthorship {
  author?: { id?: string };
  institutions?: OpenAlexInstitutionRef[];
}

export interface OpenAlexWork {
  publication_year?: number;
  authorships?: OpenAlexAuthorship[];
}

export interface SummaryData {
  summary: string;
  highlights: Array<{
    paper: string;
    detail: string;
    authorPosition?: string;
    doi?: string | null;
  }>;
  questions: string[];
}

export interface EmailFlag {
  type: string;
  issue: string;
  suggestion: string;
}

export const ANON_SUMMARY_LIMIT = 2;
export const MAX_CITATIONS = 100_000;
export const MAX_PAPERS = 500;
export const PROFESSORS_PER_PAGE = 5;
export const PLACEHOLDER_EXAMPLES = [
  "e.g. neuroscience",
  "e.g. organic chemistry",
  "e.g. political science",
  "e.g. machine learning",
  "e.g. cardiology",
  "e.g. astrophysics",
  "e.g. behavioral economics",
  "e.g. robotics",
  "e.g. immunology",
] as const;

const OA_TIMEOUT_MS = 15_000;
const GENUINE_AFFILIATION_MIN_YEARS = 3;

const US_STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

export class RateLimitError extends Error {}

export const THROTTLE_MSG =
  "ResearchMatch is getting a lot of searches right now and hit a temporary limit. Give it a moment and try again — your search terms are fine.";

export function isThrottle(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Adds the polite-pool identity and a bounded timeout to OpenAlex requests. */
export function oaFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(oaUrl(url), { signal: AbortSignal.timeout(OA_TIMEOUT_MS), ...init });
}

export function formatInstitutionLocation(
  institution: Author["last_known_institutions"][number] | undefined,
): string {
  if (!institution) return "";
  const { display_name: name, country_code: countryCode, geo } = institution;
  const city = geo?.city;
  const region = geo?.region;
  const country = geo?.country;
  if (!city && !region) return name;
  if (countryCode === "US") {
    const stateCode = region ? (US_STATE_CODES[region] ?? region) : "";
    return city ? `${name}, ${city}${stateCode ? `, ${stateCode}` : ""}` : name;
  }
  return city && country ? `${name}, ${city}, ${country}` : name;
}

export function matchedAffiliationYears(author: Author, institutionIds: string[]): number {
  let years = 0;
  for (const affiliation of author.affiliations ?? []) {
    if (affiliation.institution?.id && institutionIds.includes(affiliation.institution.id)) {
      years = Math.max(years, (affiliation.years ?? []).length);
    }
  }
  return years;
}

/** Moves the most established current affiliation to the first display position. */
export function homeInstitutionFirst(author: Author): void {
  const institutions = author.last_known_institutions ?? [];
  const affiliations = author.affiliations ?? [];
  if (institutions.length <= 1 || affiliations.length === 0) return;

  const score = (institutionId?: string) => {
    const affiliation = institutionId
      ? affiliations.find((item) => item.institution?.id === institutionId)
      : undefined;
    const years = affiliation?.years ?? [];
    return years.length
      ? { recent: Math.max(...years), span: Math.max(...years) - Math.min(...years) }
      : { recent: 0, span: 0 };
  };

  institutions.sort((left, right) => {
    const leftScore = score(left?.id);
    const rightScore = score(right?.id);
    return rightScore.recent - leftScore.recent || rightScore.span - leftScore.span;
  });
}

/**
 * Confirms an institution match and promotes genuine multi-year affiliations.
 * Thin one- or two-year matches stay searchable but display the author's home.
 */
export function promoteMatchedInstitution(author: Author, institutionIds: string[]): boolean {
  const institutions = author.last_known_institutions ?? [];
  const matchIndex = institutions.findIndex(
    (institution) => institution?.id && institutionIds.includes(institution.id),
  );
  if (matchIndex < 0) return false;

  const hasYearData = (author.affiliations?.length ?? 0) > 0;
  const isGenuine = matchedAffiliationYears(author, institutionIds) >= GENUINE_AFFILIATION_MIN_YEARS;
  if (!hasYearData || isGenuine) {
    if (matchIndex > 0) {
      const [matched] = institutions.splice(matchIndex, 1);
      institutions.unshift(matched);
    }
  } else {
    homeInstitutionFirst(author);
  }
  return true;
}

export function isGhostAuthor(author: Author): boolean {
  return !author.orcid && (author.works_count ?? 0) < 5;
}

/** Collapses OpenAlex fragments while preserving distinct ORCID identities. */
export function dedupeAuthors(authors: Author[]): Author[] {
  const byIdentity = new Map<string, Author>();
  for (const author of authors.filter((item) => !isGhostAuthor(item))) {
    const baseKey = foldName(author.display_name) || author.id;
    const existing = byIdentity.get(baseKey);
    if (!existing) {
      byIdentity.set(baseKey, author);
      continue;
    }
    if (author.orcid && existing.orcid && author.orcid !== existing.orcid) {
      byIdentity.set(`${baseKey}#${author.orcid}`, author);
      continue;
    }
    const qualityDifference =
      Number(Boolean(author.orcid)) - Number(Boolean(existing.orcid)) ||
      author.works_count - existing.works_count ||
      author.cited_by_count - existing.cited_by_count;
    if (qualityDifference > 0) byIdentity.set(baseKey, author);
  }
  return Array.from(byIdentity.values());
}

export function topicRelevanceRank(author: Author, topicIds: string[]): number {
  const authorTopicIds = (author.topics ?? []).map((topic) => topic.id?.split("/").pop());
  let best = Infinity;
  for (let index = 0; index < topicIds.length; index += 1) {
    const position = authorTopicIds.indexOf(topicIds[index]);
    if (position >= 0) best = Math.min(best, position * 10 + index);
  }
  return best === Infinity ? 9_999 : best;
}

export async function lookupAuthorsByName(
  name: string,
  institutionIds: string[],
): Promise<Author[]> {
  const response = await oaFetch(
    `https://api.openalex.org/authors?search=${encodeURIComponent(name.trim())}&per_page=25&sort=cited_by_count:desc&select=id,display_name,orcid,last_known_institutions,affiliations,works_count,cited_by_count,topics`,
  );
  const data = await response.json();
  let authors = ((data.results ?? []) as Author[]).filter((author) =>
    nameMatches(name, author.display_name),
  );
  authors = dedupeAuthors(authors);
  authors.forEach(homeInstitutionFirst);
  if (institutionIds.length > 0) {
    const atInstitution = authors.filter((author) =>
      promoteMatchedInstitution(author, institutionIds),
    );
    if (atInstitution.length > 0) authors = atInstitution;
  }
  return authors.sort(
    (left, right) =>
      Number(Boolean(right.orcid)) - Number(Boolean(left.orcid)) ||
      right.cited_by_count - left.cited_by_count,
  );
}

/** Fetches a batch of OpenAlex author records and applies institution matching once. */
export async function lookupAuthorsByIds(
  authorIds: string[],
  institutionIds: string[],
): Promise<Author[]> {
  if (authorIds.length === 0) return [];
  const response = await oaFetch(
    `https://api.openalex.org/authors?filter=ids.openalex:${authorIds.join("|")}&per_page=${authorIds.length}&select=id,display_name,orcid,last_known_institutions,affiliations,works_count,cited_by_count,topics`,
  ).catch(() => null);
  if (!response?.ok) return [];

  const data = await response.json().catch(() => null);
  const authors = ((data?.results ?? []) as Array<Author | null>).filter(
    (author): author is Author => Boolean(author?.id),
  );
  const uniqueAuthors = new Map<string, Author>();
  for (const author of authors) {
    if (institutionIds.length > 0 && !promoteMatchedInstitution(author, institutionIds)) continue;
    uniqueAuthors.set(author.id, author);
  }
  return Array.from(uniqueAuthors.values())
    .sort((left, right) => right.cited_by_count - left.cited_by_count);
}

export function formatCitations(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return count.toString();
}
