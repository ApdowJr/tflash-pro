/** Bounded retries for reattaching a stream, never for sending turns or tools. */
export const MAX_STREAM_RECONNECTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export function streamReconnectDelay(error: unknown, attempt: number, random = Math.random, now = Date.now()): number | undefined {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_STREAM_RECONNECTS || !error || typeof error !== "object") return undefined;
  const value = error as { name?: unknown; message?: unknown; status?: unknown; headers?: unknown };
  if (value.name === "AbortError") return undefined;
  const status = typeof value.status === "number" ? value.status : undefined;
  const transient = status !== undefined
    ? [408, 429, 500, 502, 503, 504].includes(status)
    : value.name === "TypeError" && typeof value.message === "string" && /failed to fetch|networkerror|network request failed|fetch failed/i.test(value.message);
  if (!transient) return undefined;
  const exponential = Math.min(500 * 2 ** attempt, 5_000);
  const base = exponential + Math.floor(Math.max(0, Math.min(0.999, random())) * exponential * 0.2);
  const headers = value.headers && typeof value.headers === "object" ? value.headers as Record<string, unknown> : undefined;
  const retryAfter = headers?.["retry-after"];
  if (retryAfter === undefined) return base;
  if (typeof retryAfter !== "string" || !retryAfter.trim()) return undefined;
  const text = retryAfter.trim();
  const seconds = /^\d+$/.test(text) ? Number(text) : undefined;
  const date = seconds === undefined ? Date.parse(text) : undefined;
  const wait = seconds !== undefined ? seconds * 1000 : date !== undefined && Number.isFinite(date) ? Math.max(0, date - now) : NaN;
  // Never silently retry earlier than instructed; leave long/invalid waits for a person.
  return Number.isFinite(wait) && wait <= MAX_RETRY_AFTER_MS ? Math.max(base, wait) : undefined;
}
