import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  allowRequestRate,
  consumeUsage,
  releaseUsage,
  requestAccess,
  requestSubject,
} from "@/lib/server-access";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

    const extract = (s: string | null | undefined): { followUp1?: string; followUp2?: string } | null => {
      if (!s) return null;
      try { return JSON.parse(s); } catch { /* not clean JSON */ }
      const m = s.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch { /* still bad */ } }
      return null;
    };

    // Retry + salvage on Groq's occasional json_validate_failed, like summarize/email.
    let parsed: { followUp1?: string; followUp2?: string } | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const chat = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You write short, genuine follow-up emails for students reaching out to professors. Return only valid JSON. No extra text." },
            { role: "user", content: userContent },
          ],
          max_tokens: 700,
          temperature: attempt === 0 ? 0.65 : 0.5,
          response_format: { type: "json_object" },
        });
        parsed = extract(chat.choices[0]?.message?.content);
      } catch (err) {
        const e = err as { error?: { failed_generation?: string }; failed_generation?: string };
        parsed = extract(e.error?.failed_generation ?? e.failed_generation);
      }
    }

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
