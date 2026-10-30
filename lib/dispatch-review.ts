/** Browser-tab recovery hint only: this is not a remote idempotency key or lock. */
export function dispatchReviewKey(kind: string, userId: string, sessionId: string): string {
  return `tflash:dispatch-review:v1:${encodeURIComponent(kind)}:${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`;
}
export function dispatchStorage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
export function readDispatchReview(storage: Storage | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function tokens(raw: string | null): string[] {
  if (!raw) return [];
  try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed; }
  catch { /* Preserve an older or malformed marker instead of losing it. */ }
  return [raw];
}
export function markDispatchReview(storage: Storage | undefined, key: string, token: string): boolean {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify([...tokens(storage.getItem(key)), token])); return true; } catch { return false; }
}
export function clearDispatchReview(storage: Storage | undefined, key: string, token: string): void {
  try {
    if (!storage) return;
    const remaining = tokens(storage.getItem(key)).filter((item) => item !== token);
    if (remaining.length) storage.setItem(key, JSON.stringify(remaining)); else storage.removeItem(key);
  } catch { /* A stale marker is safer than an unsafe retry. */ }
}
/** The user has explicitly reviewed every outstanding marker in this tab. */
export function clearReviewedDispatches(storage: Storage | undefined, key: string): void {
  try { storage?.removeItem(key); } catch { /* Keep the warning if removal fails. */ }
}
