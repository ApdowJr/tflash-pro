import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

const validSession = (id: string) => /^[a-zA-Z0-9_-]{1,200}$/.test(id);
export type SharedDispatchWarning = { key: string; raw: string | null };
/** Browser-origin breadcrumbs, not locks, idempotency keys or evidence of execution. */
export function sharedDispatchWarnings(kind: string, userId: string, sessionId: string): SharedDispatchWarning[] {
  return syncUncertaintyMarkers("turn-dispatch", kind, userId).flatMap(key => {
    const raw = window.localStorage.getItem(key);
    try {
      const parsed: unknown = JSON.parse(raw ?? "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>;
        if (typeof value.sessionId === "string" && validSession(value.sessionId) && Object.keys(value).length === 1)
          return value.sessionId === sessionId ? [{ key, raw }] : [];
      }
    } catch { /* Invalid markers block conservatively for the account. */ }
    return [{ key, raw }];
  });
}
export function beginSharedDispatch(kind: string, userId: string, sessionId: string): string {
  if (!validSession(sessionId)) throw new Error("Invalid session identifier.");
  if (syncUncertaintyMarkers("turn-dispatch", kind, userId).length >= 2000) throw new Error("Recovery capacity reached.");
  return beginSyncUncertainty("turn-dispatch", kind, userId, JSON.stringify({ sessionId }));
}
/** Automatic cleanup only removes the exact untouched marker this component created. */
export function clearOwnedSharedDispatch(key: string, sessionId: string): void {
  const value = window.localStorage.getItem(key);
  if (value === null) return; // Someone else already reviewed it.
  if (value !== JSON.stringify({ sessionId })) throw new Error("Recovery marker changed.");
  clearSyncUncertainty([key]);
  if (window.localStorage.getItem(key) !== null) throw new Error("Recovery marker not removed.");
}
export function clearReviewedSharedDispatch(key: string, expected: string | null) {
  if (window.localStorage.getItem(key) !== expected) throw new Error("Recovery marker changed.");
  clearSyncUncertainty([key]);
  if (window.localStorage.getItem(key) !== null) throw new Error("Recovery marker not removed.");
}
