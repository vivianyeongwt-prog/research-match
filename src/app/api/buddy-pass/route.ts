import { NextRequest, NextResponse } from "next/server";
import { generateReferralCode, isReferralCode, normalizeReferralCode } from "@/lib/buddy-pass";
import { allowRequestRate, requestAccess, supabaseAdmin } from "@/lib/server-access";
import { siteOrigin } from "@/lib/site-url";

async function ensureReferralCode(userId: string, currentCode?: string | null) {
  const normalizedCurrentCode = normalizeReferralCode(currentCode ?? "");
  if (isReferralCode(normalizedCurrentCode)) return normalizedCurrentCode;

  const referralCode = generateReferralCode(userId);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ referral_code: referralCode })
    .eq("id", userId)
    .select("referral_code")
    .maybeSingle();

  if (error || !data?.referral_code) {
    throw error ?? new Error("Referral code update did not match a profile.");
  }
  return data.referral_code;
}

export async function GET(req: NextRequest) {
  try {
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    const userId = access.user.id;
    if (!(await allowRequestRate(req, "buddy-pass-read", 12, userId))) {
      return NextResponse.json({ error: "Too many Buddy Pass checks." }, { status: 429 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, referral_code, buddy_pass_weeks_available, buddy_pass_weeks_earned, buddy_pass_weeks_used, buddy_pass_active_until")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const referralCode = await ensureReferralCode(userId, profile.referral_code);

    const { data: referrals, error: referralsError } = await supabaseAdmin
      .from("buddy_pass_referrals")
      .select("id, created_at, reward_weeks, discount_percent, status")
      .eq("referrer_id", userId)
      .eq("status", "rewarded")
      .order("created_at", { ascending: false })
      .limit(8);

    if (referralsError) throw referralsError;

    const { count: referralCount, error: referralCountError } = await supabaseAdmin
      .from("buddy_pass_referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("status", "rewarded");
    if (referralCountError) throw referralCountError;

    const activeUntil = profile.buddy_pass_active_until;
    const active = activeUntil ? new Date(activeUntil).getTime() > Date.now() : false;

    return NextResponse.json({
      referralCode,
      referralUrl: `${siteOrigin()}/app?buddy=${encodeURIComponent(referralCode)}`,
      weeksAvailable: profile.buddy_pass_weeks_available ?? 0,
      weeksEarned: profile.buddy_pass_weeks_earned ?? 0,
      weeksUsed: profile.buddy_pass_weeks_used ?? 0,
      activeUntil,
      active,
      successfulReferrals: referralCount ?? 0,
      referrals: (referrals ?? []).map((referral) => ({
        id: referral.id,
        friendEmail: "Friend",
        createdAt: referral.created_at,
        rewardWeeks: referral.reward_weeks,
        discountPercent: referral.discount_percent,
      })),
    });
  } catch (err) {
    console.error("buddy pass GET error:", err);
    return NextResponse.json({ error: "Could not load Buddy Pass." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    const userId = access.user.id;
    if (!(await allowRequestRate(req, "buddy-pass-activate", 4, userId, 600))) {
      return NextResponse.json({ error: "Too many activation attempts." }, { status: 429 });
    }

    const { action } = await req.json();
    if (action !== "activate") {
      return NextResponse.json({ error: "Invalid Buddy Pass action." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("activate_buddy_pass_week", {
      p_user_id: userId,
    });

    if (error) {
      const message = error.message?.toLowerCase().includes("no buddy pass")
        ? "No Buddy Pass weeks available."
        : "Could not activate Buddy Pass.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const activatedWeek = Array.isArray(data) ? data[0] : null;
    return NextResponse.json({
      activeUntil: activatedWeek?.active_until ?? null,
      weeksAvailable: activatedWeek?.weeks_available ?? 0,
      activated: true,
    });
  } catch (err) {
    console.error("buddy pass POST error:", err);
    return NextResponse.json({ error: "Could not update Buddy Pass." }, { status: 500 });
  }
}
