import { NextRequest, NextResponse } from "next/server";
import { oaUrl, isOaAuthorId } from "@/lib/openalex";
import { generateJSON } from "@/lib/llm";
import {
  allowRequestRate,
  requestAccess,
  requestSubject,
  supabaseAdmin,
} from "@/lib/server-access";

const FREE_LIMIT = 2;
const ANON_LIMIT = 2;

interface OpenAlexAuthorship {
  author?: { id?: string };
  author_position?: string;
}

interface OpenAlexWork {
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: OpenAlexAuthorship[];
  doi?: string | null;
}

// Structured-output schema for Claude Haiku.
const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    highlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { paper: { type: "string" }, detail: { type: "string" } },
        required: ["paper", "detail"],
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "highlights", "questions"],
};

export async function POST(req: NextRequest) {
  let quotaReservation: { userId: string | null; anonSubject: string | null } | null = null;
  try {
    const { authorId } = await req.json();
    if (!isOaAuthorId(authorId)) {
      return NextResponse.json({ error: "authorId required" }, { status: 400 });
    }

    const access = await requestAccess(req);
    if (!(await allowRequestRate(req, "summarize", 12, access.user?.id))) {
      return NextResponse.json({ error: "Too many summaries. Try again in a minute." }, { status: 429 });
    }

    if (!access.isPaid) {
      const userId = access.user?.id ?? null;
      const anonSubject = userId ? null : requestSubject(req);
      const { data: reserved, error: reserveError } = await supabaseAdmin.rpc("consume_summary_quota", {
        p_user_id: userId,
        p_anon_subject: anonSubject,
        p_limit: userId ? FREE_LIMIT : ANON_LIMIT,
      });
      if (reserveError) {
        console.error("summarize: quota reservation failed:", reserveError);
        return NextResponse.json({ error: "Usage could not be verified. Please try again." }, { status: 503 });
      }
      if (reserved !== true) {
        return NextResponse.json({ error: "limit_reached" }, { status: 403 });
      }
      quotaReservation = { userId, anonSubject };
    }

    // --- Fetch recent papers ---
    const fromYear = new Date().getFullYear() - 3;
    const worksRes = await fetch(
      oaUrl(`https://api.openalex.org/works?filter=author.id:${encodeURIComponent(authorId)},publication_year:>${fromYear}&sort=cited_by_count:desc&per_page=20&select=title,abstract_inverted_index,cited_by_count,publication_year,authorships,doi`),
      { signal: AbortSignal.timeout(8_000) }
    );
    // A throttled/erroring OpenAlex response must NOT read as "this researcher has
    // no recent papers" — that's a false claim. Surface a retryable error instead.
    if (!worksRes.ok) {
      if (quotaReservation) {
        await supabaseAdmin.rpc("release_summary_quota", {
          p_user_id: quotaReservation.userId,
          p_anon_subject: quotaReservation.anonSubject,
        });
        quotaReservation = null;
      }
      console.error(`summarize: OpenAlex works fetch failed (${worksRes.status}) for ${authorId}`);
      return NextResponse.json(
        { error: "The paper database is busy right now. Please try again in a moment." },
        { status: 503 }
      );
    }
    const worksData = await worksRes.json();
    const allWorks = (worksData.results ?? []) as OpenAlexWork[];
    const works = allWorks.slice(0, 8);

    if (works.length === 0) {
      if (quotaReservation) {
        await supabaseAdmin.rpc("release_summary_quota", {
          p_user_id: quotaReservation.userId,
          p_anon_subject: quotaReservation.anonSubject,
        });
        quotaReservation = null;
      }
      return NextResponse.json({ summary: "No recent papers found for this researcher.", highlights: [] });
    }

    // Get author position and DOI for each paper
    const authorPositions: Record<string, string> = {};
    const paperDois: Record<string, string> = {};
    for (const w of works) {
      const authorship = w.authorships?.find(
        (a) => a.author?.id === `https://openalex.org/${authorId}`
      );
      if (authorship && w.title) {
        authorPositions[w.title] = authorship.author_position ?? "unknown";
      }
      if (w.title && w.doi) {
        paperDois[w.title] = w.doi;
      }
    }

    // Reconstruct abstracts from inverted index
    const papers = works.map((w) => {
      let abstract = "";
      if (w.abstract_inverted_index) {
        const words: { word: string; pos: number }[] = [];
        for (const [word, positions] of Object.entries(w.abstract_inverted_index as Record<string, number[]>)) {
          for (const pos of positions) {
            words.push({ word, pos });
          }
        }
        abstract = words
          .sort((a, b) => a.pos - b.pos)
          .map((w) => w.word)
          .join(" ");
      }
      return `Title: ${w.title}\nYear: ${w.publication_year}\nCitations: ${w.cited_by_count}\n${abstract ? `Abstract: ${abstract.slice(0, 300)}` : ""}`;
    });

    const prompt = `Here are the top research papers by a professor:

${papers.join("\n\n---\n\n")}

Return a JSON object with two fields:
1. "summary": 3-4 sentences describing what this professor actually works on. Be specific: name the real topics, methods, or problems they study. Write like you're explaining to a smart undergrad. Use plain, direct language. No jargon, no filler phrases like "significant contributions" or "robust frameworks". Do not start with "This professor".
2. "highlights": an array of 3 objects, each with:
   - "paper": the exact paper title
   - "detail": one specific finding, method, or result from that paper. Focus on what they actually discovered or built, a number, a comparison, a technique. Never just restate the title or topic. Explain the concrete outcome in one sentence, plain English.
3. "questions": an array of 3 strings. Generate 3 questions a curious student might naturally ask over coffee. Reference something specific from the abstracts but make it conversational. Start questions with "I noticed", "I was wondering", "What made you decide to" instead of "How do you plan to" or "Can you discuss". Never compliment the research. Never use phrases like "I found your work fascinating." Should sound like genuine curiosity, not an interview.

Return only valid JSON, no markdown, no explanation.`;

    const SYSTEM = "You explain research in plain, specific language. You never use academic filler words. You never use em dashes; use commas or periods instead. You always return a single, valid JSON object.";

    const parsed = await generateJSON<{ summary?: string; highlights?: { paper: string; detail: string }[]; questions?: string[] }>({
      system: SYSTEM,
      prompt,
      schema: SUMMARY_SCHEMA,
      maxTokens: 700,
      temperature: 0.3,
    });

    // Never dump a raw error to the user — return a clean, retry-able message.
    if (!parsed) {
      if (quotaReservation) {
        await supabaseAdmin.rpc("release_summary_quota", {
          p_user_id: quotaReservation.userId,
          p_anon_subject: quotaReservation.anonSubject,
        });
        quotaReservation = null;
      }
      return NextResponse.json({
        summary: "We couldn't generate a summary for this professor right now. Please try again.",
        highlights: [],
        questions: [],
      });
    }

    const highlightsWithPosition = (parsed.highlights ?? []).map((h) => ({
      ...h,
      authorPosition: authorPositions[h.paper] ?? "unknown",
      doi: paperDois[h.paper] ?? null,
    }));

    const result = {
      summary: parsed.summary ?? "",
      highlights: highlightsWithPosition,
      questions: parsed.questions ?? [],
    };

    // A free use was reserved atomically before model work. Refund it when no real
    // result was produced; otherwise the reservation is the durable usage count.
    const gotRealContent = highlightsWithPosition.length > 0 &&
      !result.summary.includes("unavailable") &&
      !result.summary.includes("No recent papers");

    if (!gotRealContent && quotaReservation) {
      await supabaseAdmin.rpc("release_summary_quota", {
        p_user_id: quotaReservation.userId,
        p_anon_subject: quotaReservation.anonSubject,
      });
      quotaReservation = null;
    }

    return NextResponse.json(result);
  } catch (err) {
    if (quotaReservation) {
      await supabaseAdmin.rpc("release_summary_quota", {
        p_user_id: quotaReservation.userId,
        p_anon_subject: quotaReservation.anonSubject,
      });
    }
    console.error("summarize error:", err);
    return NextResponse.json(
      { error: "Something went wrong generating the summary. Please try again." },
      { status: 500 }
    );
  }
}
