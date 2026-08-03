import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  clearPendingReferralCode,
  emailCheckStorageKey,
  readAnonSummariesUsed,
  readPendingReferralCode,
  readSavedProfessors,
  storePendingReferralCode,
} from "../src/lib/browser-storage";

function useStorage(values: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  });
}

describe("browser storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the current anonymous summary counter", () => {
    useStorage({ [STORAGE_KEYS.anonymousSummariesUsed]: "2" });
    expect(readAnonSummariesUsed()).toBe(2);
  });

  it("migrates the legacy free-summary flag", () => {
    useStorage({ [STORAGE_KEYS.legacyFreeSummaryViewed]: "true" });
    expect(readAnonSummariesUsed()).toBe(1);
  });

  it("returns an empty list for malformed saved-professor data", () => {
    useStorage({ [STORAGE_KEYS.savedProfessors]: "not-json" });
    expect(readSavedProfessors()).toEqual([]);
  });

  it("reads saved professors and scopes email checks per user", () => {
    useStorage({ [STORAGE_KEYS.savedProfessors]: JSON.stringify([{ id: "A1" }]) });
    expect(readSavedProfessors<{ id: string }>()).toEqual([{ id: "A1" }]);
    expect(emailCheckStorageKey("user-1")).toBe("rm-email-check-user-1");
  });

  it("keeps a normalized Buddy code through a signup-sized navigation gap", () => {
    const values: Record<string, string> = {};
    useStorage(values);
    const now = Date.UTC(2026, 7, 3);

    storePendingReferralCode("rm-abcd-1234", now);

    expect(readPendingReferralCode(now + 60_000)).toBe("RMABCD1234");
    expect(JSON.parse(values[STORAGE_KEYS.pendingBuddyReferral])).toEqual({
      code: "RMABCD1234",
      storedAt: now,
    });
  });

  it("expires and clears stale Buddy attribution", () => {
    const values: Record<string, string> = {};
    useStorage(values);
    const now = Date.UTC(2026, 7, 3);
    storePendingReferralCode("RMABCD1234", now);

    expect(readPendingReferralCode(now + 8 * 24 * 60 * 60 * 1000)).toBe("");
    expect(values[STORAGE_KEYS.pendingBuddyReferral]).toBeUndefined();

    storePendingReferralCode("RMABCD1234", now);
    clearPendingReferralCode();
    expect(readPendingReferralCode(now)).toBe("");
  });
});
