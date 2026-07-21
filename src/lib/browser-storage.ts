export const STORAGE_KEYS = {
  anonymousSummariesUsed: "rm-anon-summaries-used",
  legacyFreeSummaryViewed: "hasViewedFreeSummary",
  savedProfessors: "research-match-saved",
  visits: "research-match-visits",
  lastVisit: "research-match-last-visit",
  pendingSummary: "rm-pending-summarize",
  pendingPromo: "rm-pending-promo",
} as const;

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
