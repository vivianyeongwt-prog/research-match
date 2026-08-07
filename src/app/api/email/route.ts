import { NextRequest, NextResponse } from "next/server";
import { generateJSON } from "@/lib/llm";
import {
  allowRequestRate,
  consumeUsage,
  releaseUsage,
  requestAccess,
  requestSubject,
} from "@/lib/server-access";

const RATE_LIMIT_MAX_CHECKS = 12;

interface EmailHighlight {
  paper: string;
}

interface EmailReviewRequest {
  draft?: string;
  professorName?: string;
  institution?: string;
  topics?: string[];
  highlights?: EmailHighlight[];
}

// Structured-output schema for Claude Haiku.
const EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["error", "warning"] },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["type", "issue", "suggestion"],
      },
    },
  },
  required: ["flags"],
};

export async function POST(req: NextRequest) {
  let quotaReservation: { scope: string; subject: string } | null = null;
  try {
    const { draft, professorName, institution, topics, highlights } = await req.json() as EmailReviewRequest;

    if (typeof draft !== "string" || draft.trim().length < 10) {
      return NextResponse.json({
        flags: [
          {
            type: "error",
            issue: "Email is too short",
            suggestion:
              "Write at least a few sentences introducing yourself and why you're reaching out.",
          },
        ],
      });
    }
    if (
      draft.length > 5_000 ||
      (professorName !== undefined && (typeof professorName !== "string" || professorName.length > 200)) ||
      (institution !== undefined && (typeof institution !== "string" || institution.length > 300)) ||
      (topics !== undefined && (!Array.isArray(topics) || topics.length > 10 || topics.some((topic) => typeof topic !== "string" || topic.length > 160))) ||
      (highlights !== undefined && (!Array.isArray(highlights) || highlights.length > 10 || highlights.some((highlight) => typeof highlight?.paper !== "string" || highlight.paper.length > 500)))
    ) {
      return NextResponse.json({ error: "Email review input is too large or malformed." }, { status: 400 });
    }

    const access = await requestAccess(req);
    const subject = requestSubject(req, access.user?.id);
    if (!(await allowRequestRate(req, "email", RATE_LIMIT_MAX_CHECKS, access.user?.id))) {
      return NextResponse.json({ error: "Too many email checks. Try again in a minute." }, { status: 429 });
    }

    // The server owns the trial. Local storage only changes how the button looks;
    // it cannot grant another model call or reveal a paid result.
    if (!access.isPaid) {
      const scope = access.user ? "email-check:free-account" : "email-check:anonymous";
      if (!(await consumeUsage(scope, subject, 1))) {
        return NextResponse.json(
          { error: access.user ? "upgrade_required" : "signup_required" },
          { status: 403 }
        );
      }
      quotaReservation = { scope, subject };
    }

    const hasPapers = !!highlights?.length;
    const topicList = topics?.length ? topics.join(", ") : "";

    // Give the model the professor's papers when we have them. When we DON'T (the
    // summary hadn't loaded yet when the student hit "Check"), fall back to their
    // research areas AND explicitly tell the model not to penalize the email for a
    // missing paper reference. Without this guard the checker flagged "no specific
    // paper" / "sounds generic" purely because no papers were in the request — the
    // false positives that made it feel inaccurate even on a well-written email.
    const contextBlock = hasPapers
      ? `The professor's recent papers include:\n${highlights!.map((h) => `- "${h.paper}"`).join("\n")}`
      : `The professor's papers are not available in this request${topicList ? `. Their research areas are: ${topicList}` : ""}.\n` +
        `Because the papers were not provided, do NOT raise "NO SPECIFIC PAPER" or "SOUNDS GENERIC" on the basis of a missing paper reference. Judge the email on its other merits${topicList ? " and on whether it connects to those research areas" : ""}.`;

    const prompt = `Review this cold email to Professor ${professorName}${institution ? ` at ${institution}` : ""}.

${contextBlock}

The email:
"""
${draft}
"""

For each check below, first look for evidence in the email, then decide whether to flag:

1. TOO LONG: over 200 words. Count carefully.
2. NO SPECIFIC PAPER: flag ONLY if the email does not mention any paper title, specific finding, or concrete research detail. Referencing a specific result like "2.7B parameter model outperforming larger models" counts as specific.
3. MISSING AN ASK: flag ONLY if there is no question, request for a meeting, or expression of interest in joining. Asking about their research direction counts.
4. SOUNDS GENERIC: flag ONLY if the email could be copy-pasted to a different professor with just the name changed. If it references specific research details unique to this professor, it is NOT generic.
5. NO PERSONAL CONNECTION: flag ONLY if the student never mentions their own projects, classes, experiences, or why they personally care about this topic. Mentioning their own work counts.
6. TOO MUCH FLATTERY: flag ONLY if it uses words like "groundbreaking," "deeply inspired," "incredible," "revolutionary."
7. ASKING FOR TOO MUCH: flag if asking for paid work, funding, or admission in a first email.
8. NO INTRODUCTION: flag ONLY if the student never states their name, school, or year.
9. SYCOPHANTIC TONE: flag if the email contains excessive flattery, offers to do anything the professor wants, or uses phrases like "groundbreaking work", "it would be an honor", "deeply inspired", "incredible contributions", "I am willing to do whatever you ask", "I would love to research anything you need." This tone screams AI-generated and signals no real interests.

Return JSON: { "flags": [ { "type": "error" or "warning", "issue": "FLAG_NAME", "suggestion": "one sentence explanation" } ] }
Only flag real problems. If the email is solid, return { "flags": [] }. Max 4 flags.`;

    const SYSTEM = "You are a strict but fair cold email reviewer. Only flag an issue when the email contains specific evidence for it. Mention the relevant phrase or concrete absence in the suggestion. If you cannot identify evidence, do not flag it. Write each suggestion without em dashes; use commas or periods instead. You return valid JSON only.";

    const parsed = await generateJSON<{ flags?: { type: string; issue: string; suggestion: string }[] }>({
      system: SYSTEM,
      prompt,
      schema: EMAIL_SCHEMA,
      maxTokens: 500,
      temperature: 0.2,
    });

    if (!parsed) {
      if (quotaReservation) await releaseUsage(quotaReservation.scope, quotaReservation.subject);
      return NextResponse.json({ error: "Couldn't check your email right now. Please try again." }, { status: 503 });
    }
    const flags = parsed.flags ?? [];
    if (!access.user) {
      return NextResponse.json({ flags: flags.slice(0, 1), totalFlags: flags.length, gated: true });
    }
    return NextResponse.json({ flags, totalFlags: flags.length, gated: false });
  } catch (err) {
    if (quotaReservation) await releaseUsage(quotaReservation.scope, quotaReservation.subject);
    console.error("email check error:", err);
    return NextResponse.json({ error: "Couldn't check your email right now. Please try again." }, { status: 500 });
  }
}
