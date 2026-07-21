const DEFAULT_API_TIMEOUT_MS = 35_000;

/** Prevent a stalled server request from leaving a client loading state forever. */
export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_API_TIMEOUT_MS
) {
  return fetch(input, { signal: AbortSignal.timeout(timeoutMs), ...init });
}
