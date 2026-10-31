import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

export type ControlScope = "control-permission" | "control-task" | "control-continuation";
export type ControlAction = "grant" | "revoke" | "revoke-all" | "save" | "cancel" | "reserve" | "begin" | "hold" | "resolve";
export type ControlWarning = { key: string; sessionId?: string; action?: ControlAction };
const actionSets: Record<ControlScope, readonly ControlAction[]> = {
  "control-permission": ["grant", "revoke", "revoke-all"],
  "control-task": ["save", "cancel"],
  "control-continuation": ["reserve", "begin", "hold", "resolve"],
};
export function controlWarnings(scope: ControlScope, kind: string, userId: string, sessionId: string): ControlWarning[] {
  return syncUncertaintyMarkers(scope, kind, userId).flatMap((key) => {
    try {
      const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (raw && typeof raw === "object") {
        const entry = raw as Record<string, unknown>;
        if (typeof entry.sessionId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(entry.sessionId) &&
            typeof entry.action === "string" && actionSets[scope].includes(entry.action as ControlAction))
          return entry.sessionId === sessionId ? [{ key, sessionId, action: entry.action as ControlAction }] : [];
      }
    } catch { /* Unknown markers block conservatively across the account. */ }
    return [{ key }];
  });
}
export function beginControlAction(scope: ControlScope, kind: string, userId: string, sessionId: string, action: ControlAction): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || !actionSets[scope].includes(action)) throw new Error("Invalid control action.");
  if (syncUncertaintyMarkers(scope, kind, userId).length >= 2000) throw new Error("Recovery capacity reached.");
  return beginSyncUncertainty(scope, kind, userId, JSON.stringify({ sessionId, action }));
}
export function clearControlAction(key: string) { clearSyncUncertainty([key]); }
