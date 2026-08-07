// Phase 3: generate the per-field copy in field_content using Claude Haiku, grounded in
// each field's REAL subfields and the actual recent_topic values pulled for its
// professors — so the output is specific per field, not templated mush.
//
// Usage:
//   node scripts/seo-generate-content.mjs neuroscience --dry-run   # print only
//   node scripts/seo-generate-content.mjs neuroscience             # write to Supabase
//   node scripts/seo-generate-content.mjs all
//
// Uses the same buyer-owned Anthropic key as the runtime AI tools. Field anchors
// come from the shared scripts/lib/research-anchors.mjs.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { FIELDS, resolveAnchorTopics, fetchFieldProfessors, sleep } from "./lib/research-anchors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && !key.startsWith("#")) process.env[key.trim()] ??= rest.join("=").trim();
  }
} catch {
  console.error("Could not read .env.local at repo root.");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required.");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    research_overview: { type: "string" },
    remote_friendly: {
      type: "string",
      enum: ["remote-friendly", "hands-on", "mixed"],
    },
    email_angle: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "meta_title",
    "meta_description",
    "research_overview",
    "remote_friendly",
    "email_angle",
    "faq",
  ],
  additionalProperties: false,
};

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// Grounding = real subfields (anchor topic names) + the actual recent topics and
// institutions of this field's professors. Pulled from the DB when populated, or
// live from OpenAlex during a pre-DB dry run.
async function groundingFor(field, supabase) {
  let rows = [];
  if (supabase) {
    const { data } = await supabase
      .from("field_professors")
      .select("recent_topic, institution")
      .eq("field_slug", field.slug);
    rows = data ?? [];
  }
  if (rows.length === 0) {
    // Pre-DB dry run: pull live so we can still preview grounded content.
    const live = await fetchFieldProfessors(field);
    rows = live.rows;
  }
  // Ground on the professors' own recent topics — these passed the relevance gate,
  // so they're clean and on-field (unlike raw anchor topics, which can be noisy).
  let topics = uniq(rows.map((r) => r.recent_topic)).slice(0, 12);
  if (topics.length === 0) topics = (await resolveAnchorTopics(field.anchor)).map((t) => t.name).slice(0, 10);
  return {
    topics,
    institutions: uniq(rows.map((r) => r.institution)).slice(0, 8),
  };
}

function buildPrompt(field, g) {
  return `You are writing the content for a web page that helps students land a research position in ${field.name}.

Use ONLY these real specifics about this field (do not invent others):
- Real research topics from actual professors in this field: ${g.topics.join("; ")}
- Example institutions: ${g.institutions.join("; ")}

CRITICAL RULES:
- Write COMPLETE sentences. Every sentence must end with a period. Never stop mid-thought or end with "like University of X".
- Hit the length targets. Do not write short. Reach the lower word count at minimum.
- Be specific to ${field.name} using the real topics above. No filler ("fascinating", "cutting-edge", "groundbreaking"). 7th-8th grade reading level.

Return a JSON object with EXACTLY these fields:

1. "meta_title": 35-58 characters. Must contain "${field.name}" and "Research Position". Strongly prefer the shape "How to Get a ${field.name} Research Position".

2. "meta_description": ONE complete sentence, 150-160 characters, ending with a period. Mention ${field.name}, finding professors and emailing them, and one concrete hook.

3. "research_overview": a full paragraph of 95-130 words (6-9 complete sentences). Explain what ${field.name} researchers actually study, naming AT LEAST 4 of the real topics above. Then say plainly whether the day-to-day work is mostly remote (computation, data, theory), hands-on (wet lab, clinical, fieldwork), or a mix, and why.

4. "remote_friendly": exactly one of "remote-friendly", "hands-on", or "mixed", matching research_overview. Guidance: wet-lab chemistry, bench biology, clinical, and fieldwork-heavy areas are "hands-on"; computation, data, and theory areas are "remote-friendly"; use "mixed" ONLY when the field genuinely splits down the middle.

5. "email_angle": 95-120 words (several complete sentences) of concrete advice for emailing a ${field.name} professor. MUST be specific to ${field.name}. If the field is computational/remote-friendly, tell the student to offer to contribute remotely with code, data analysis, or replication, and to name a relevant skill tied to the topics above. If hands-on, tell them to emphasize being on-site, learning specific bench/lab/clinical techniques, and being reliable with protocols. Mention one or two of the real topics above. No flattery. No "I am passionate" or "your groundbreaking work".

6. "faq": an array of EXACTLY 4 objects, each { "question": string, "answer": string }. Questions are real "People Also Ask"-style queries about getting into ${field.name} research (qualifications, remote vs in-person, what to say in the email, timing/when to apply). Each answer is 2-3 complete sentences, 40-55 words, specific to ${field.name}, ending with a period.

Return ONLY valid JSON. No markdown, no commentary.`;
}

// Trim to a clean sentence/word boundary at or under `max` chars.
function trimClean(text, max) {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastPeriod = cut.lastIndexOf(". ");
  if (lastPeriod > max * 0.6) return cut.slice(0, lastPeriod + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, "") + ".";
}

function fallbackTitle(field) {
  const t = `How to Get a ${field.name} Research Position`;
  return t.length <= 60 ? t : `${field.name} Research Positions`;
}

async function generate(field, supabase) {
  const g = await groundingFor(field, supabase);
  const message = await anthropic.messages.create({
    model: MODEL,
    system:
      "You write specific, grounded, plain-language web content for students. You never use filler or hype.",
    messages: [{ role: "user", content: buildPrompt(field, g) }],
    max_tokens: 2200,
    output_config: { format: { type: "json_schema", schema: CONTENT_SCHEMA } },
  });

  const text = message.content.find((block) => block.type === "text");
  const raw = text?.type === "text" ? text.text.trim() : "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Anthropic returned invalid JSON");
  }

  // Validate + normalize.
  let metaTitle = (parsed.meta_title ?? "").trim();
  if (!metaTitle || metaTitle.length > 60) metaTitle = fallbackTitle(field);
  const remote = ["remote-friendly", "hands-on", "mixed"].includes(parsed.remote_friendly)
    ? parsed.remote_friendly
    : "mixed";
  const faq = Array.isArray(parsed.faq)
    ? parsed.faq.filter((f) => f && f.question && f.answer).slice(0, 4)
    : [];

  return {
    field_slug: field.slug,
    field_name: field.name,
    meta_title: metaTitle,
    meta_description: trimClean(parsed.meta_description, 160),
    email_angle: (parsed.email_angle ?? "").trim(),
    research_overview: (parsed.research_overview ?? "").trim(),
    remote_friendly: remote,
    faq,
  };
}

function printContent(c) {
  console.log(`\n=== ${c.field_name} (${c.field_slug}) ===`);
  console.log(`meta_title (${c.meta_title.length}): ${c.meta_title}`);
  console.log(`meta_description (${c.meta_description.length}): ${c.meta_description}`);
  console.log(`remote_friendly: ${c.remote_friendly}`);
  console.log(`\nresearch_overview:\n${c.research_overview}`);
  console.log(`\nemail_angle:\n${c.email_angle}`);
  console.log(`\nfaq:`);
  c.faq.forEach((f, i) => console.log(`  Q${i + 1}: ${f.question}\n      ${f.answer}`));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const target = args.find((a) => !a.startsWith("--")) || "all";
  const fields = target === "all" ? FIELDS : FIELDS.filter((f) => f.slug === target);
  if (fields.length === 0) {
    console.error(`Unknown field "${target}". Known: ${FIELDS.map((f) => f.slug).join(", ")}`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let supabase = null;
  // Always try to connect (we read professors for grounding); in dry-run we just
  // don't write. If tables don't exist yet, groundingFor falls back to live fetch.
  if (url && key) supabase = createClient(url, key);

  for (const field of fields) {
    try {
      const content = await generate(field, dryRun ? null : supabase);
      printContent(content);
      if (!dryRun) {
        if (!supabase) throw new Error("Missing Supabase env for write");
        const { error } = await supabase.from("field_content").upsert(content, { onConflict: "field_slug" });
        if (error) throw new Error(error.message);
        console.log(`✅ stored field_content for ${field.slug}`);
      }
    } catch (err) {
      console.error(`❌ ${field.slug}: ${err.message}`);
    }
    await sleep(500);
  }
  console.log(`\n${dryRun ? "DRY RUN — nothing written." : "Done writing field_content."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
