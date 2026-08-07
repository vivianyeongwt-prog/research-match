import { NextRequest, NextResponse } from "next/server";
import { generateJSON } from "@/lib/llm";
import {
  allowRequestRate,
  consumeUsage,
  releaseUsage,
  requestAccess,
  requestSubject,
} from "@/lib/server-access";

export async function POST(req: NextRequest) {
  let quotaReservation: { scope: string; subject: string } | null = null;
  try {
    const { email } = await req.json();
    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (email.length > 10_000) {
      return NextResponse.json({ error: "Email is too long." }, { status: 400 });
    }

    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "Sign in to generate a follow-up." }, { status: 401 });
    }
    if (!(await allowRequestRate(req, "follow-up", 4, access.user.id))) {
      return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
    }
    if (!access.isPaid) {
      const subject = requestSubject(req, access.user.id);
      const scope = "follow-up:free-account";
      if (!(await consumeUsage(scope, subject, 1))) {
        return NextResponse.json({ error: "upgrade_required" }, { status: 403 });
      }
      quotaReservation = { scope, subject };
    }

    const userContent = `A student sent this cold email to a professor:

---
${email}
---

Write two follow-up emails. Each one should be 3-4 sentences max. Respectful, specific, not desperate. Never use em dashes; use commas or periods instead. Extract the professor's name from the email if present, otherwise use "[Professor's name]". Extract the student's name/sign-off if present, otherwise use "[Your name]".

Follow-Up 1 (sent 7 days after the original):
- Open: "Hi Professor [name], just wanted to follow up on my email from last week."
- One sentence referencing something specific from their original email (a paper they mentioned, their background, the ask)
- Soft close: "I'd love to hear your thoughts if you have a moment."
- Sign-off with student's name

Follow-Up 2 (sent 14 days after the original):
- Open: "Hi Professor [name], I know this is a busy time of year."
- One sentence that adds a new angle or a new question; do NOT just repeat follow-up 1
- Clear close: "If the timing isn't right, no worries at all. I appreciate your time either way."
- Sign-off with student's name

Return JSON exactly like this:
{
  "followUp1": "full email text here",
  "followUp2": "full email text here"
}`;

    const parsed = await generateJSON<{ followUp1?: string; followUp2?: string }>({
      system:
        "You write short, genuine follow-up emails for students reaching out to professors. Return only the requested fields.",
      prompt: userContent,
      maxTokens: 700,
      schema: {
        type: "object",
        properties: {
          followUp1: { type: "string" },
          followUp2: { type: "string" },
        },
        required: ["followUp1", "followUp2"],
        additionalProperties: false,
      },
    });

    if (
      !parsed ||
      typeof parsed.followUp1 !== "string" ||
      parsed.followUp1.trim().length === 0 ||
      typeof parsed.followUp2 !== "string" ||
      parsed.followUp2.trim().length === 0
    ) {
      if (quotaReservation) await releaseUsage(quotaReservation.scope, quotaReservation.subject);
      return NextResponse.json({ error: "Couldn't generate follow-ups right now. Please try again." }, { status: 503 });
    }
    return NextResponse.json({
      followUp1: parsed.followUp1,
      followUp2: parsed.followUp2,
    });
  } catch (err) {
    if (quotaReservation) await releaseUsage(quotaReservation.scope, quotaReservation.subject);
    console.error("follow-up error:", err);
    return NextResponse.json({ error: "Couldn't generate follow-ups right now. Please try again." }, { status: 500 });
  }
}
