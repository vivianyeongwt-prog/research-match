// Bidirectional internal links between the blog posts and the /research/[field]
// pages. Both clusters used to be isolated: no blog post linked to a field page
// and no field page linked to a post, so the field pages were reachable only via
// the /research hub and Google left them in "Discovered - currently not indexed".
//
// One assignment table drives both directions, so the links are reciprocal and a
// post/field pair can never disagree about whether they are related.

import { posts, type BlogPost } from "@/app/blog/posts";
import {
  RESEARCH_FIELDS,
  RESEARCH_FIELD_SLUGS,
  getResearchField,
  type ResearchField,
} from "./research-fields";

/** Field links rendered per blog post. */
const FIELDS_PER_POST = 4;
/** Guide links rendered per field page. */
const POSTS_PER_FIELD = 3;

/**
 * Posts whose subject matter genuinely points at specific fields. Everything not
 * listed here is about the outreach process rather than a discipline, so it gets
 * filled by the coverage pass below instead of a forced topical guess.
 */
const CURATED_FIELDS: Record<string, string[]> = {
  "premed-research-experience": ["cancer-biology", "immunology", "microbiology", "public-health"],
  "research-experience-for-phd-applications": ["neuroscience", "machine-learning", "genetics", "materials-science"],
  "undergraduate-research-benefits": ["psychology", "cognitive-science", "environmental-science", "biochemistry"],
};

/**
 * Assign fields to posts so inbound links spread evenly across all field pages.
 * Curated picks win; remaining slots go to the least-linked fields, ties broken
 * by canonical field order. Fully deterministic — same output on every build,
 * which keeps statically rendered pages stable between deploys.
 */
function buildAssignment(): Map<string, string[]> {
  const usage = new Map<string, number>(RESEARCH_FIELD_SLUGS.map((s) => [s, 0]));
  const assignment = new Map<string, string[]>();

  for (const post of posts) {
    const curated = (CURATED_FIELDS[post.slug] ?? []).filter((s) => usage.has(s));
    const picked = [...new Set(curated)].slice(0, FIELDS_PER_POST);

    while (picked.length < FIELDS_PER_POST) {
      const remaining = RESEARCH_FIELD_SLUGS.filter((s) => !picked.includes(s));
      if (remaining.length === 0) break;
      const leastUsed = remaining.reduce((best, s) =>
        (usage.get(s) ?? 0) < (usage.get(best) ?? 0) ? s : best
      );
      picked.push(leastUsed);
    }

    for (const s of picked) usage.set(s, (usage.get(s) ?? 0) + 1);
    assignment.set(post.slug, picked);
  }

  return assignment;
}

const ASSIGNMENT = buildAssignment();

/** Reverse index: field slug -> post slugs that link to it. */
const REVERSE = (() => {
  const map = new Map<string, string[]>(RESEARCH_FIELD_SLUGS.map((s) => [s, []]));
  for (const [postSlug, fieldSlugs] of ASSIGNMENT) {
    for (const fieldSlug of fieldSlugs) map.get(fieldSlug)?.push(postSlug);
  }
  return map;
})();

/**
 * Field pages to link from a blog post. `populated` must come from
 * getPopulatedFieldSlugs(), which is the same set generateStaticParams builds
 * from — the route sets dynamicParams = false, so linking to anything outside
 * that set is a hard 404.
 */
export function fieldsForPost(postSlug: string, populated: string[]): ResearchField[] {
  const allowed = new Set(populated);
  const picked = (ASSIGNMENT.get(postSlug) ?? [])
    .filter((s) => allowed.has(s))
    .map((s) => getResearchField(s))
    .filter((f): f is ResearchField => !!f);

  // Backfill if curated/assigned fields were dropped for not being populated,
  // so a post never renders a half-empty block.
  if (picked.length < FIELDS_PER_POST) {
    for (const field of RESEARCH_FIELDS) {
      if (picked.length >= FIELDS_PER_POST) break;
      if (allowed.has(field.slug) && !picked.some((f) => f.slug === field.slug)) {
        picked.push(field);
      }
    }
  }

  return picked.slice(0, FIELDS_PER_POST);
}

/** Blog posts to link from a field page. */
export function postsForField(fieldSlug: string): BlogPost[] {
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const picked = (REVERSE.get(fieldSlug) ?? [])
    .map((s) => bySlug.get(s))
    .filter((p): p is BlogPost => !!p);

  // A field with few reciprocal posts still deserves a full block, so top up
  // from the front of the post list (the evergreen outreach guides).
  if (picked.length < POSTS_PER_FIELD) {
    for (const post of posts) {
      if (picked.length >= POSTS_PER_FIELD) break;
      if (!picked.some((p) => p.slug === post.slug)) picked.push(post);
    }
  }

  return picked.slice(0, POSTS_PER_FIELD);
}
