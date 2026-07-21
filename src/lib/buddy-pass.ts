export type BuddyPassProfile = {
  id?: string | null;
  email?: string | null;
  plan_type?: string | null;
  plan_expires_at?: string | null;
  buddy_pass_active_until?: string | null;
};

const PAID_PLAN_TYPES = new Set([
  "weekly",
  "semester",
  "student_monthly",
  "student_annual",
  "lifetime",
]);

export function normalizeReferralCode(code: string) {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
}

export function generateReferralCode(userId: string) {
  return `RM${userId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function hasActiveBuddyPass(profile?: BuddyPassProfile | null, now = new Date()) {
  if (!profile?.buddy_pass_active_until) return false;
  return new Date(profile.buddy_pass_active_until).getTime() > now.getTime();
}

export function hasPaidPlan(profile?: BuddyPassProfile | null, now = new Date()) {
  if (!profile?.plan_type || !PAID_PLAN_TYPES.has(profile.plan_type)) return false;
  if (profile.plan_type === "lifetime") return true;
  if (!profile.plan_expires_at) return true;
  return new Date(profile.plan_expires_at).getTime() > now.getTime();
}

export function hasPaidAccess(profile?: BuddyPassProfile | null, now = new Date()) {
  return hasPaidPlan(profile, now) || hasActiveBuddyPass(profile, now);
}

export function planLabelFor(profile?: BuddyPassProfile | null) {
  if (hasPaidPlan(profile)) {
    if (profile?.plan_type === "lifetime") return "Lifetime";
    if (profile?.plan_type === "weekly") return "Weekly";
    if (
      profile?.plan_type === "semester" ||
      profile?.plan_type === "student_monthly" ||
      profile?.plan_type === "student_annual"
    ) {
      return "Semester";
    }
  }
  if (hasActiveBuddyPass(profile)) return "Buddy Pass";
  return "Free";
}

export function formatBuddyPassDate(date?: string | null) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
