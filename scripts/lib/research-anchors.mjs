// Shared OpenAlex logic for the programmatic /research SEO pages.
// Imported by seo-fetch-professors.mjs (Phase 1/2) and seo-generate-content.mjs
// (Phase 3) so the field list, taxonomy anchors, and fetch behavior never drift.
//
// Each field's `anchor` ties it to OpenAlex's taxonomy (validated empirically):
//   { kind: "subfield", id }       — a precise OpenAlex subfield (best signal)
//   { kind: "field", id }          — a broad OpenAlex field (umbrella terms)
//   { kind: "topicsearch", terms } — single-phrase topic searches, unioned
//                                    (for interdisciplinary fields with no subfield)

export const FIELDS = [
  { slug: "neuroscience", name: "Neuroscience", anchor: { kind: "field", id: 28 } },
  { slug: "computational-biology", name: "Computational Biology", anchor: { kind: "topicsearch", terms: ["computational biology", "systems biology"], excludeNames: ["Cerebrospinal fluid", "Educational Leadership"] } },
  { slug: "bioinformatics", name: "Bioinformatics", anchor: { kind: "topicsearch", terms: ["bioinformatics"] } },
  { slug: "machine-learning", name: "Machine Learning", anchor: { kind: "subfield", id: 1702 } },
  { slug: "cancer-biology", name: "Cancer Biology", anchor: { kind: "subfield", id: 1306 } },
  { slug: "immunology", name: "Immunology", anchor: { kind: "subfield", id: 2403 } },
  { slug: "psychology", name: "Psychology", anchor: { kind: "field", id: 32 } },
  { slug: "organic-chemistry", name: "Organic Chemistry", anchor: { kind: "subfield", id: 1605 } },
  { slug: "materials-science", name: "Materials Science", anchor: { kind: "field", id: 25 } },
  { slug: "genetics", name: "Genetics", anchor: { kind: "subfield", id: 1311 } },
  { slug: "public-health", name: "Public Health", anchor: { kind: "subfield", id: 2739 } },
  { slug: "epidemiology", name: "Epidemiology", anchor: { kind: "subfield", id: 2713 } },
  { slug: "molecular-biology", name: "Molecular Biology", anchor: { kind: "subfield", id: 1312 } },
  { slug: "biomedical-engineering", name: "Biomedical Engineering", anchor: { kind: "topicsearch", terms: ["biomedical engineering", "tissue engineering", "medical imaging", "biomechanics", "neural engineering"], excludeNames: ["Metal-Organic Frameworks"] } },
  { slug: "cognitive-science", name: "Cognitive Science", anchor: { kind: "subfield", id: 3205 } },
  { slug: "astrophysics", name: "Astrophysics", anchor: { kind: "subfield", id: 3103 } },
  { slug: "environmental-science", name: "Environmental Science", anchor: { kind: "field", id: 23 } },
  { slug: "microbiology", name: "Microbiology", anchor: { kind: "subfield", id: 2404 } },
  { slug: "biochemistry", name: "Biochemistry", anchor: { kind: "subfield", id: 1303 } },
  { slug: "robotics", name: "Robotics", anchor: { kind: "topicsearch", terms: ["robotics", "robot manipulation", "human-robot interaction", "soft robotics"] } },
];

export const TARGET_MIN = 8;
export const TARGET_MAX = 12;
const RECENT_YEARS = 3;
const MIN_RECENT_WORKS = 3;
const MAILTO = process.env.NEXT_PUBLIC_OPENALEX_MAILTO || "contact@researchmatch.site";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function oaFetch(url) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}mailto=${MAILTO}`, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": `ResearchMatch/1.0 (mailto:${MAILTO})` },
  });
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${url}`);
  return res.json();
}

// Resolve a field's anchor to a set of representative OpenAlex topics.
export async function resolveAnchorTopics(anchor) {
  if (anchor.kind === "subfield" || anchor.kind === "field") {
    const key = anchor.kind === "subfield" ? "subfield.id" : "field.id";
    const data = await oaFetch(
      `https://api.openalex.org/topics?filter=${key}:${anchor.id}&sort=works_count:desc&per_page=15&select=id,display_name`
    );
    return (data.results ?? []).map((t) => ({ id: t.id.split("/").pop(), name: t.display_name }));
  }
  const terms = anchor.terms ?? [anchor.term];
  const exclude = anchor.excludeNames ?? [];
  const out = new Map();
  for (const term of terms) {
    const data = await oaFetch(
      `https://api.openalex.org/topics?search=${encodeURIComponent(term)}&per_page=4&select=id,display_name`
    );
    for (const t of data.results ?? []) {
      const id = t.id.split("/").pop();
      if (exclude.some((x) => t.display_name.toLowerCase().includes(x.toLowerCase()))) continue;
      if (!out.has(id)) out.set(id, { id, name: t.display_name });
    }
    await sleep(120);
  }
  return [...out.values()];
}

// Confirm an author runs an ACTIVE lab: >= MIN_RECENT_WORKS works in the last
// RECENT_YEARS and a publication within the last ~2 calendar years. Filters out
// emeritus/deceased giants whose only recent attribution is a stray paper.
async function activityFor(authorId) {
  const fromYear = new Date().getFullYear() - RECENT_YEARS;
  const data = await oaFetch(
    `https://api.openalex.org/works?filter=author.id:${authorId},from_publication_date:${fromYear}-01-01` +
      `&sort=publication_date:desc&per_page=1&select=title,publication_year`
  );
  const recentCount = data.meta?.count ?? 0;
  const work = data.results?.[0];
  if (!work || recentCount < MIN_RECENT_WORKS) return null;
  const mostRecentYear = work.publication_year ?? 0;
  if (mostRecentYear < new Date().getFullYear() - 1) return null;
  return { year: mostRecentYear, title: work.title || null };
}

// Pull up to TARGET_MAX real, active, on-field professors for one field.
export async function fetchFieldProfessors(field) {
  const topics = await resolveAnchorTopics(field.anchor);
  if (topics.length === 0) return { field, matchedTopics: [], rows: [], note: "No OpenAlex topics matched anchor." };

  const anchorIds = new Set(topics.map((t) => t.id));
  const authorsData = await oaFetch(
    `https://api.openalex.org/authors?filter=topics.id:${topics.map((t) => t.id).join("|")}` +
      `&sort=cited_by_count:desc&per_page=80` +
      `&select=id,display_name,last_known_institutions,works_count,cited_by_count,topics`
  );
  const candidates = authorsData.results ?? [];

  const rows = [];
  const seen = new Set();
  for (const a of candidates) {
    if (rows.length >= TARGET_MAX) break;
    const shortId = a.id?.split("/").pop();
    if (!shortId || seen.has(shortId)) continue;
    const institution = a.last_known_institutions?.[0]?.display_name;
    if (!institution) continue;
    if ((a.works_count ?? 0) < 10) continue;

    // Relevance gate: an anchor topic must be in the author's TOP topics, not
    // just present anywhere (drops mega-cited authors who brushed the field once).
    const authorTopics = a.topics ?? [];
    const topIds = authorTopics.slice(0, 3).map((t) => t.id?.split("/").pop());
    if (!topIds.some((id) => anchorIds.has(id))) continue;

    seen.add(shortId);
    let recent;
    try {
      recent = await activityFor(shortId);
    } catch {
      recent = null;
    }
    await sleep(110);
    if (!recent) continue;

    const onFieldTopic = authorTopics.find((t) => anchorIds.has(t.id?.split("/").pop()));
    rows.push({
      field_slug: field.slug,
      field_name: field.name,
      professor_name: a.display_name,
      institution,
      recent_topic: onFieldTopic?.display_name || authorTopics[0]?.display_name || recent.title || null,
      openalex_author_id: shortId,
      last_publication_year: recent.year,
    });
  }
  return { field, matchedTopics: topics, rows };
}
