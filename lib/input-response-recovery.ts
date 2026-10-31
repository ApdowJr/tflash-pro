import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

export type InputResponseWarning = { key: string; digest?: string; mode?: "explicit" | "message" };
export async function inputRequestDigest(requestId: string): Promise<string> {
  if (!requestId || requestId.length > 1024 || !globalThis.crypto?.subtle) throw new Error("Recovery unavailable.");
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(requestId));
  return Array.from(new Uint8Array(data), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function inputResponseWarnings(kind: string, userId: string, sessionId: string): InputResponseWarning[] {
  return syncUncertaintyMarkers("input-response", kind, userId).flatMap((key) => {
    try {
      const v: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const entry = v as Record<string, unknown>;
        if (typeof entry.sessionId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(entry.sessionId) &&
          typeof entry.digest === "string" && /^[a-f0-9]{64}$/.test(entry.digest) && (entry.mode === "explicit" || entry.mode === "message"))
          return entry.sessionId === sessionId ? [{ key, digest: entry.digest, mode: entry.mode }] : [];
      }
    } catch { /* Corrupt markers block conservatively for the account. */ }
    return [{ key }];
  });
}
export function beginInputResponse(kind: string, userId: string, sessionId: string, digest: string, mode: "explicit" | "message" = "explicit") {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid recovery marker.");
  if (syncUncertaintyMarkers("input-response", kind, userId).length >= 2000) throw new Error("Recovery capacity reached.");
  if (inputResponseWarnings(kind, userId, sessionId).length) throw new Error("Review required.");
  return beginSyncUncertainty("input-response", kind, userId, JSON.stringify({ sessionId, digest, mode }));
}
export function clearInputResponse(key: string) { clearSyncUncertainty([key]); }
/** Only authoritative terminal stream events, never optimistic client.input.responded. */
export function resolvedInputRequestIds(events: readonly { type: string; data?: unknown }[]): string[] {
  const ids: string[] = [];
  for (let i = events.length - 1; i >= 0 && ids.length < 2000; i--) {
    const e = events[i];
    if (e.type !== "input.resolved" || !e.data || typeof e.data !== "object") continue;
    const values = (e.data as { resolutions?: unknown }).resolutions;
    if (!Array.isArray(values) || values.length > 2000) continue;
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const v = value as Record<string, unknown>;
      if (typeof v.requestId === "string" && v.requestId.length > 0 && v.requestId.length <= 1024 &&
        (v.kind === "tool-approval" || v.kind === "question" || v.kind === "session-limit") &&
        typeof v.outcome === "string" && ["answered", "approved", "cancelled", "denied", "ignored", "invalid"].includes(v.outcome)) ids.push(v.requestId);
      if (ids.length >= 2000) break;
    }
  }
  return ids;
}
