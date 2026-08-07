import { isReferralCode, normalizeReferralCode } from "./buddy-pass";

export const STORAGE_KEYS = {
  anonymousSummariesUsed: "rm-anon-summaries-used",
  legacyFreeSummaryViewed: "hasViewedFreeSummary",
  savedProfessors: "research-match-saved",
  visits: "research-match-visits",
  lastVisit: "research-match-last-visit",
  pendingSummary: "rm-pending-summarize",
  pendingBuddyReferral: "rm-pending-buddy-referral",
} as const;

const BUDDY_REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function emailCheckStorageKey(userId: string): string {
  return `rm-email-check-${userId}`;
}

/** Reads the anonymous allowance, including the legacy one-summary flag. */
export function readAnonSummariesUsed(): number {
  if (typeof localStorage === "undefined") return 0;
  const stored = localStorage.getItem(STORAGE_KEYS.anonymousSummariesUsed);
  if (stored !== null) return parseInt(stored, 10) || 0;
  return localStorage.getItem(STORAGE_KEYS.legacyFreeSummaryViewed) === "true" ? 1 : 0;
}

export function readSavedProfessors<T>(): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.savedProfessors) || "[]",
    );
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** Keeps a Buddy link attached to the browser through signup and Stripe cancellation. */
export function storePendingReferralCode(code: string, now = Date.now()) {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeReferralCode(code);
  try {
    if (!isReferralCode(normalized)) {
      localStorage.removeItem(STORAGE_KEYS.pendingBuddyReferral);
      return;
    }
    localStorage.setItem(
      STORAGE_KEYS.pendingBuddyReferral,
      JSON.stringify({ code: normalized, storedAt: now }),
    );
  } catch {
    // Storage can be unavailable in strict privacy modes; the URL still works.
  }
}

export function readPendingReferralCode(now = Date.now()): string {
  if (typeof localStorage === "undefined") return "";
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingBuddyReferral);
    if (!raw) return "";
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return "";
    const code = "code" in value ? normalizeReferralCode(String(value.code)) : "";
    const storedAt = "storedAt" in value ? Number(value.storedAt) : NaN;
    if (
      !isReferralCode(code) ||
      !Number.isFinite(storedAt) ||
      storedAt > now ||
      now - storedAt > BUDDY_REFERRAL_TTL_MS
    ) {
      localStorage.removeItem(STORAGE_KEYS.pendingBuddyReferral);
      return "";
    }
    return code;
  } catch {
    return "";
  }
}

export function clearPendingReferralCode() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEYS.pendingBuddyReferral);
  } catch {
    // Nothing else to do when storage is unavailable.
  }
}
