import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/client-fetch";

describe("client API fetch timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a timeout signal to ordinary API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/example", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves a caller-provided cancellation signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await apiFetch("/api/example", { signal: controller.signal }, 1);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });
});
