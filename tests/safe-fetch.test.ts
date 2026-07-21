import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchText } from "../src/lib/safe-fetch";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeFetchText network boundary", () => {
  it.each([
    "http://example.com/paper",
    "https://example.com:444/paper",
  ])("rejects non-standard HTTPS target %s before fetching", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    await expect(safeFetchText(url)).rejects.toThrow("Only public HTTPS URLs are allowed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "https://localhost/paper",
    "https://faculty.local/paper",
  ])("rejects local hostname %s before fetching", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    await expect(safeFetchText(url)).rejects.toThrow("Local network URLs are not allowed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/paper",
    "https://10.0.0.1/paper",
    "https://169.254.169.254/latest/meta-data",
    "https://172.16.0.1/paper",
    "https://192.168.0.1/paper",
    "https://[::1]/paper",
    "https://[fc00::1]/paper",
    "https://[fe80::1]/paper",
    "https://[::ffff:127.0.0.1]/paper",
    "https://[::ffff:7f00:1]/paper",
    "https://[64:ff9b::a00:1]/paper",
  ])("rejects private or disguised private address %s before fetching", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    await expect(safeFetchText(url)).rejects.toThrow("Private network URLs are not allowed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
