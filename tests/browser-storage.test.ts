import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  emailCheckStorageKey,
  readAnonSummariesUsed,
  readSavedProfessors,
} from "../src/lib/browser-storage";

function useStorage(values: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values[key] ?? null,
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
});
