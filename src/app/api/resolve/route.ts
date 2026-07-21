import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { oaUrl } from "@/lib/openalex";
import { allowRequestRate } from "@/lib/server-access";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Step 1: Use LLM to expand a user query into OpenAlex-friendly search terms.
// OpenAlex's topic taxonomy uses specific academic phrases — "applied math" doesn't
// exist but "mathematical modeling", "numerical analysis", etc. do.
async function expandToSearchTerms(topic: string): Promise<string[]> {
  try {
    const chat = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You convert an informal research-topic query into formal academic search terms that match an academic paper database's topic taxonomy. Return only a JSON array of strings. No explanation.

Decide first whether the query is BROAD or SPECIFIC:
- BROAD field with many distinct sub-areas (e.g. "materials science", "chemistry", "biology", "physics", "climate science", "economics"): return 6-8 terms naming the MAJOR DISTINCT SUB-FIELDS that together span the field — NOT near-synonyms of the umbrella term. Naming real sub-fields is what surfaces specialists across the whole field instead of one narrow corner of it.
- SPECIFIC topic (e.g. "DNA methylation", "CRISPR", "gravitational waves", "natural language processing"): return 3-4 close synonyms or formal variants ONLY. Do NOT broaden a specific topic into its parent field.

Use full formal names, not abbreviations. Examples:
- "applied math" → ["mathematical modeling", "numerical analysis", "computational mathematics", "optimization", "differential equations"]
- "materials science" → ["nanomaterials", "semiconductor materials", "battery materials and energy storage", "polymer science", "metallurgy and alloys", "ceramics", "two-dimensional materials and graphene", "computational materials science"]
- "organic chemistry" → ["organic synthesis", "catalysis", "medicinal chemistry", "polymer chemistry", "organometallic chemistry", "total synthesis of natural products"]
- "climate science" → ["climate change", "atmospheric science", "oceanography", "climate modeling", "paleoclimatology", "carbon cycle and biogeochemistry"]
- "bio" → ["molecular biology", "biochemistry", "genetics", "cell biology", "microbiology", "neuroscience"]
- "DNA methylation" → ["DNA methylation", "epigenetics", "epigenetic regulation", "chromatin modification"]
- "CRISPR" → ["CRISPR", "gene editing", "genome engineering", "Cas9 nuclease"]
- "ML" → ["machine learning", "deep learning", "artificial intelligence", "neural networks"]`,
        },
        {
          role: "user",
          content: `Research topic query: "${topic}"\n\nReturn 3-5 formal academic search terms as a JSON array.`,
        },
      ],
      max_tokens: 220,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = chat.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    // Accept array at root or under any key
    const arr = Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray) as string[] ?? [];
    return arr.filter((s): s is string => typeof s === "string").slice(0, 8);
  } catch {
    // Fallback: just return the original query
    return [topic];
  }
}

async function pickBestIndices(
  query: string,
  candidates: { id: string; display_name: string }[],
  entityType: string,
  maxPick: number
): Promise<number[]> {
  const list = candidates.map((c, i) => `${i}: ${c.display_name}`).join("\n");
  const chat = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You pick the best matching items from a list. Reply with only comma-separated numbers (e.g. "0,2,4"); no explanation, no punctuation besides commas. Pick up to ${maxPick} items that are good matches. If none are a good match, return -1.`,
      },
      {
        role: "user",
        content: `Original user query: "${query}"\n\nCandidates:\n${list}\n\nWhich indices best match the ${entityType} for this query, including closely related variations? Return up to ${maxPick} comma-separated indices, or -1 if nothing matches.`,
      },
    ],
    max_tokens: 20,
    temperature: 0,
  });
  const raw = chat.choices[0]?.message?.content?.trim() ?? "0";
  if (raw === "-1") return [];
  const indices = raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n < candidates.length);
  return [...new Set(indices)].slice(0, maxPick);
}

// --- In-memory resolution cache ----------------------------------------------
// Topic/university resolution is effectively static but runs on every search and is
// the heaviest user of Groq + OpenAlex calls. Caching it sharply cuts that load and
// is a main lever for staying under daily rate limits. Per-serverless-instance and
// ephemeral, but a warm instance serves many requests. Only successful (non-empty)
// results are cached, so a transient upstream failure never becomes sticky.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const topicCache = new Map<string, { at: number; value: { ids: string[]; names: string[] } }>();
const uniCache = new Map<string, { at: number; value: { id: string; name: string } }>();

function cacheGet<T>(cache: Map<string, { at: number; value: T }>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  if (hit) cache.delete(key);
  return undefined;
}

async function resolveTopic(topic: string): Promise<{ ids: string[]; names: string[] }> {
  const key = topic.trim().toLowerCase();
  const cached = cacheGet(topicCache, key);
  if (cached) return cached;
  const result = await resolveTopicUncached(topic);
  if (result.ids.length > 0) topicCache.set(key, { at: Date.now(), value: result });
  return result;
}

async function resolveUniversity(university: string): Promise<{ id: string; name: string } | null> {
  const key = university.trim().toLowerCase();
  const cached = cacheGet(uniCache, key);
  if (cached) return cached;
  const result = await resolveUniversityUncached(university);
  if (result) uniCache.set(key, { at: Date.now(), value: result });
  return result;
}

async function resolveTopicUncached(topic: string): Promise<{ ids: string[]; names: string[] }> {
  try {
    // First expand to formal academic terms so OpenAlex can actually find them
    const searchTerms = await expandToSearchTerms(topic);

    // Search OpenAlex for each expanded term in parallel
    const allCandidates: { id: string; display_name: string }[] = [];
    const seenIds = new Set<string>();

    const termResults = await Promise.all(
      searchTerms.map(term =>
        fetch(
          oaUrl(`https://api.openalex.org/topics?search=${encodeURIComponent(term)}&per_page=5`),
          { signal: AbortSignal.timeout(6_000) }
        )
          // A throttled response must not read as "no such topic" — treat it like a
          // network failure so the result isn't cached as a legitimate empty match.
          .then(r => (r.ok ? r.json() : { results: [] }))
          .catch(() => ({ results: [] }))
      )
    );

    for (const data of termResults) {
      for (const topic of (data.results ?? [])) {
        if (!seenIds.has(topic.id)) {
          seenIds.add(topic.id);
          allCandidates.push(topic);
        }
      }
    }

    if (allCandidates.length === 0) return { ids: [], names: [] };

    // Let the LLM pick the best matches from all candidates. Up to 6 so a BROAD
    // query (materials science, organic chemistry) can span several real sub-fields
    // instead of collapsing to one narrow corner; a SPECIFIC query naturally yields
    // fewer good matches, so this doesn't over-broaden it.
    const indices = await pickBestIndices(topic, allCandidates, "research topic", 6);
    if (indices.length === 0) return { ids: [], names: [] };

    return {
      ids: indices.map(i => allCandidates[i].id.split("/").pop()!),
      names: indices.map(i => allCandidates[i].display_name),
    };
  } catch { return { ids: [], names: [] }; }
}

async function resolveUniversityUncached(university: string): Promise<{ id: string; name: string } | null> {
  try {
    const res = await fetch(
      oaUrl(`https://api.openalex.org/institutions?search=${encodeURIComponent(university)}&per_page=5`),
      { signal: AbortSignal.timeout(6_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const candidates: { id: string; display_name: string }[] = data.results ?? [];
    if (candidates.length === 0) return null;
    const indices = await pickBestIndices(university, candidates, "university", 1);
    if (indices.length === 0) return null;
    const i = indices[0];
    return { id: candidates[i].id.split("/").pop()!, name: candidates[i].display_name };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await allowRequestRate(req, "resolve", 12))) {
      return NextResponse.json({ error: "Too many searches. Try again in a minute." }, { status: 429 });
    }

    const body = await req.json();

    // Cap is an abuse bound only — 25 comfortably covers any real multi-topic /
    // comma-separated-university search the client can produce.
    const rawTopics = body.topics ?? (body.topic ? [body.topic] : []);
    const rawUniversities = body.universities ?? (body.university ? [body.university] : []);
    if (
      !Array.isArray(rawTopics) || !Array.isArray(rawUniversities) ||
      rawTopics.length === 0 || rawTopics.length > 25 || rawUniversities.length > 25 ||
      rawTopics.some((value) => typeof value !== "string" || !value.trim() || value.length > 200) ||
      rawUniversities.some((value) => typeof value !== "string" || !value.trim() || value.length > 200)
    ) {
      return NextResponse.json({ error: "Search terms are malformed." }, { status: 400 });
    }
    const topics = rawTopics.map((value) => value.trim());
    const universities = rawUniversities.map((value) => value.trim());

    const [topicResults, uniResults] = await Promise.all([
      Promise.all(topics.map(resolveTopic)),
      Promise.all(universities.map(resolveUniversity)),
    ]);

    // Flatten and deduplicate all resolved topic IDs
    const allTopicIds: string[] = [];
    const allTopicNames: string[] = [];
    for (const r of topicResults) {
      for (let i = 0; i < r.ids.length; i++) {
        if (!allTopicIds.includes(r.ids[i])) {
          allTopicIds.push(r.ids[i]);
          allTopicNames.push(r.names[i]);
        }
      }
    }

    const resolvedUnis = uniResults.filter(Boolean) as { id: string; name: string }[];

    return NextResponse.json({
      topicIds: allTopicIds,
      topicNames: allTopicNames,
      institutionIds: resolvedUnis.map(u => u.id),
      institutionNames: resolvedUnis.map(u => u.name),
      // Legacy fields
      topicId: allTopicIds[0] ?? null,
      topicName: allTopicNames[0] ?? topics[0] ?? "",
      institutionId: resolvedUnis[0]?.id ?? null,
      institutionName: resolvedUnis[0]?.name ?? null,
    });
  } catch (err) {
    console.error("resolve error:", err);
    return NextResponse.json({ error: "Could not interpret your search terms. Please try again." }, { status: 500 });
  }
}
