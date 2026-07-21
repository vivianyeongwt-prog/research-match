import { NextRequest, NextResponse } from "next/server";
import { allowRequestRate, requestAccess, supabaseAdmin } from "@/lib/server-access";

export async function POST(req: NextRequest) {
  try {
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "Sign in to redeem a promo code." }, { status: 401 });
    }
    if (!(await allowRequestRate(req, "promo", 8, access.user.id, 600))) {
      return NextResponse.json({ error: "Too many promo attempts. Try again later." }, { status: 429 });
    }

    const { code } = await req.json();
    if (typeof code !== "string" || !/^[A-Z0-9_-]{2,40}$/i.test(code.trim())) {
      return NextResponse.json({ error: "Enter a valid promo code." }, { status: 400 });
    }

    const { data: result, error } = await supabaseAdmin.rpc("redeem_promo_code", {
      p_user_id: access.user.id,
      p_code: code.trim().toUpperCase(),
    });
    if (error) throw error;
    if (result === "invalid") return NextResponse.json({ error: "Invalid promo code." }, { status: 400 });
    if (result === "expired") return NextResponse.json({ error: "This promo code has expired." }, { status: 400 });
    if (result === "already_paid") return NextResponse.json({ error: "Your account already has this plan or better." }, { status: 409 });
    if (result !== "success") throw new Error("Unexpected promo result");

    return NextResponse.json({ success: true, plan: "semester" });
  } catch (err) {
    console.error("promo error:", err);
    return NextResponse.json({ error: "Could not apply the promo code. Please try again." }, { status: 500 });
  }
}
