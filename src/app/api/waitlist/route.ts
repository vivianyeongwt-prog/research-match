import { NextRequest, NextResponse } from "next/server";
import { isPlausibleEmail } from "@/lib/rate-limit";
import { allowRequestRate, supabaseAdmin } from "@/lib/server-access";

export async function POST(req: NextRequest) {
  try {
    if (!(await allowRequestRate(req, "waitlist", 5))) {
      return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
    }

    const { email, tier } = await req.json();
    if (!isPlausibleEmail(email) || !tier || typeof tier !== "string" || tier.length > 50) {
      return NextResponse.json({ error: "A valid email and tier are required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("waitlist").insert({
      email: email.trim().toLowerCase(),
      tier,
      created_at: new Date().toISOString(),
    });

    if (error && error.code !== "23505") {
      console.error("waitlist error:", error);
      return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("waitlist error:", err);
    return NextResponse.json({ error: "Could not join the waitlist." }, { status: 500 });
  }
}
