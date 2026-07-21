import { NextRequest, NextResponse } from "next/server";
import { isPlausibleEmail } from "@/lib/rate-limit";
import { allowRequestRate, supabaseAdmin } from "@/lib/server-access";

export async function POST(req: NextRequest) {
  try {
    if (!(await allowRequestRate(req, "contact", 5))) {
      return NextResponse.json({ error: "Too many messages. Try again in a minute." }, { status: 429 });
    }

    const { name, email, message } = await req.json();
    if (
      typeof name !== "string" || !name.trim() || name.length > 200 ||
      !isPlausibleEmail(email) ||
      typeof message !== "string" || !message.trim() || message.length > 5000
    ) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("contact_messages").insert({
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contact error:", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
