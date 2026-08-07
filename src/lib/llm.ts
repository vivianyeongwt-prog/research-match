import Anthropic from "@anthropic-ai/sdk";

// One shared runtime provider keeps the buyer handoff simple: every AI feature
// uses the same buyer-owned Anthropic key and pinned Claude Haiku snapshot.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export const aiProvider = "anthropic" as const;
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Pull a JSON object out of a model response, tolerating stray prose/markdown.
function tryExtractJSON(s: string | null | undefined): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* not clean JSON */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* still bad */ } }
  return null;
}

export interface GenerateJSONOptions {
  system: string;
  prompt: string;
  // JSON Schema for structured outputs — keep it within the supported subset:
  // every object needs additionalProperties:false and all keys in required; no
  // min/maxLength or numeric bounds.
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature?: number;
}

// Returns a parsed JSON object, or null when Anthropic is unavailable or rejects
// the request. Route handlers keep their existing user-safe fallback behavior.
export async function generateJSON<T = unknown>(opts: GenerateJSONOptions): Promise<T | null> {
  const { system, prompt, schema, maxTokens, temperature } = opts;
  if (!anthropic) return null;
  try {
    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
      ...(typeof temperature === "number" ? { temperature } : {}),
    });
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return (tryExtractJSON(block?.text) as T) ?? null;
  } catch (err) {
    console.warn("anthropic generateJSON failed:", (err as Error)?.message);
    return null;
  }
}
