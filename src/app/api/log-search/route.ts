import { NextRequest, NextResponse } from "next/server";
import { allowRequestRate, requestAccess, supabaseAdmin } from "@/lib/server-access";

export async function POST(req: NextRequest) {
  try {
    const access = await requestAccess(req);
    if (!(await allowRequestRate(req, "log-search", 30, access.user?.id))) {
      return NextResponse.json({ error: "Too many search events." }, { status: 429 });
    }
    const { research_interest, university } = await req.json();
    if (
      typeof research_interest !== "string" || !research_interest.trim() || research_interest.length > 500 ||
      (university !== null && university !== undefined && (typeof university !== "string" || university.length > 300))
    ) {
      return NextResponse.json({ error: "Search event is malformed." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("search_logs").insert({
      research_interest: research_interest.trim(),
      university: typeof university === "string" ? university.trim() || null : null,
      is_authenticated: !!access.user,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("search logging failed:", err);
    // Silently fail — logging should never break the user experience
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
