import { createHmac } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { generateReferralCode, hasPaidAccess } from "@/lib/buddy-pass";
import { clientIp, withinRateLimit } from "@/lib/rate-limit";
import { requiredServerSetting } from "@/lib/server-env";

export const supabaseAdmin = createClient(
  requiredServerSetting("NEXT_PUBLIC_SUPABASE_URL"),
  requiredServerSetting("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export type ServerProfile = {
  id: string;
  email?: string | null;
  plan_type?: string | null;
  plan_expires_at?: string | null;
  buddy_pass_active_until?: string | null;
  summaries_used?: number | null;
};

export type RequestAccess = {
  user: User | null;
  profile: ServerProfile | null;
  isPaid: boolean;
};

function bearerToken(req: NextRequest) {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

async function ensureProfile(user: User, anonSubject: string): Promise<ServerProfile> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, plan_type, plan_expires_at, buddy_pass_active_until, summaries_used")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) throw new Error(`Could not read account access: ${readError.message}`);
  const { data: anonUse, error: anonReadError } = await supabaseAdmin
    .from("anon_summary_uses")
    .select("count")
    .eq("ip", anonSubject)
    .maybeSingle();
  if (anonReadError) throw new Error(`Could not read anonymous usage: ${anonReadError.message}`);

  // Account creation must not reset the anonymous trial. The conditional update
  // prevents a concurrent account request from ever lowering the durable count.
  if (existing) {
    const carriedCount = Math.min(Number(anonUse?.count ?? 0), 2);
    if (carriedCount > Number(existing.summaries_used ?? 0)) {
      const { data: reconciled, error: reconcileError } = await supabaseAdmin
        .from("profiles")
        .update({ summaries_used: carriedCount })
        .eq("id", user.id)
        .lt("summaries_used", carriedCount)
        .select("id, email, plan_type, plan_expires_at, buddy_pass_active_until, summaries_used")
        .maybeSingle();
      if (reconcileError) throw new Error(`Could not reconcile account usage: ${reconcileError.message}`);
      if (reconciled) return reconciled as ServerProfile;
    }
    return existing as ServerProfile;
  }

  const { error: insertError } = await supabaseAdmin.from("profiles").insert({
    id: user.id,
    email: user.email ?? "",
    plan_type: "free",
    referral_code: generateReferralCode(user.id),
    summaries_used: Math.min(Number(anonUse?.count ?? 0), 2),
  });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Could not create account profile: ${insertError.message}`);
  }

  const { data: created, error: rereadError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, plan_type, plan_expires_at, buddy_pass_active_until, summaries_used")
    .eq("id", user.id)
    .single();
  if (rereadError || !created) {
    throw new Error(`Could not verify account profile: ${rereadError?.message ?? "missing row"}`);
  }
  return created as ServerProfile;
}

export async function requestAccess(req: NextRequest): Promise<RequestAccess> {
  const token = bearerToken(req);
  if (!token) return { user: null, profile: null, isPaid: false };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { user: null, profile: null, isPaid: false };

  const profile = await ensureProfile(data.user, requestSubject(req));
  return { user: data.user, profile, isPaid: hasPaidAccess(profile) };
}

function usageSecret() {
  return (
    process.env.RATE_LIMIT_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "research-match-development-only"
  );
}

/** Stable, non-PII key used by database-backed quota and rate-limit buckets. */
export function requestSubject(req: NextRequest, userId?: string | null) {
  if (userId) return `user:${userId}`;
  return `ip:${createHmac("sha256", usageSecret()).update(clientIp(req)).digest("hex")}`;
}

export async function consumeUsage(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds = 0
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("consume_api_usage", {
    p_scope: scope,
    p_subject_hash: subject,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (!error) return data === true;
  // Keep local development usable before the migration is applied. Production
  // fails closed because a missing quota ledger must never turn paid APIs free.
  if (process.env.NODE_ENV === "development") {
    return withinRateLimit(`${scope}:${subject}`, limit, windowSeconds > 0 ? windowSeconds * 1000 : 365 * 24 * 60 * 60 * 1000);
  }
  console.error(`Usage ledger failed for ${scope}:`, error);
  return false;
}

export async function releaseUsage(
  scope: string,
  subject: string,
  windowSeconds = 0
) {
  const { error } = await supabaseAdmin.rpc("release_api_usage", {
    p_scope: scope,
    p_subject_hash: subject,
    p_window_seconds: windowSeconds,
  });
  if (error && process.env.NODE_ENV !== "development") {
    console.error(`Usage release failed for ${scope}:`, error);
  }
}

export async function allowRequestRate(
  req: NextRequest,
  scope: string,
  max: number,
  userId?: string | null,
  windowSeconds = 60
) {
  return consumeUsage(`rate:${scope}`, requestSubject(req, userId), max, windowSeconds);
}
