import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

// IDs are opaque identifiers, not tool inputs or credentials. Only an exact
// turn-scoped cancellation can be correlated with a terminal stream event.
export type StopWarning = { key: string; turnId?: string };
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,200}$/.test(id);
export function stopWarnings(kind: string, userId: string, sessionId: string): StopWarning[] {
  return syncUncertaintyMarkers("stop-request", kind, userId).flatMap(key => {
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const entry = value as Record<string, unknown>;
        if (typeof entry.sessionId === "string" && validId(entry.sessionId) &&
            (entry.turnId === null || (typeof entry.turnId === "string" && validId(entry.turnId)))) {
          return entry.sessionId === sessionId ? [{ key, ...(typeof entry.turnId === "string" ? { turnId: entry.turnId } : {}) }] : [];
        }
      }
    } catch { /* Corruption must not hide an uncertain stop. */ }
    return [{ key }];
  });
}
export function beginStop(kind: string, userId: string, sessionId: string, turnId?: string): string {
  if (!validId(sessionId) || (turnId !== undefined && !validId(turnId))) throw new Error("Invalid stop marker.");
  if (syncUncertaintyMarkers("stop-request", kind, userId).length >= 2000) throw new Error("Recovery capacity reached.");
  return beginSyncUncertainty("stop-request", kind, userId, JSON.stringify({ sessionId, turnId: turnId ?? null }));
}
export function clearStop(key: string) { clearSyncUncertainty([key]); }
/** A cancellation boundary is complete only after the following session.waiting.
 * Projection state and a bare turn.cancelled are not a settled stream tail. */
export function cancelledStopTurns(events: readonly { type: string; data?: unknown }[]): Set<string> {
  const result = new Set<string>();
  const pending = new Set<string>();
  for (const event of events) {
    if (event.type === "session.waiting") {
      for (const id of pending) result.add(id);
      pending.clear();
      continue;
    }
    if (event.type !== "turn.cancelled" || !event.data || typeof event.data !== "object") continue;
    const id = (event.data as { turnId?: unknown }).turnId;
    if (typeof id === "string" && validId(id)) pending.add(id);
  }
  return result;
}
export function isStopTurnId(id: unknown): id is string { return typeof id === "string" && validId(id); }
