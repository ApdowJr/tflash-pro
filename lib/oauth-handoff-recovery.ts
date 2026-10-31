import { beginSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

export type HandoffWarning = { readonly key: string; readonly integrationId?: string };
/** Marker contains no grant, cookie, token or provider response. */
export function handoffWarnings(kind: string, userId: string): HandoffWarning[] {
  return syncUncertaintyMarkers("oauth-handoff", kind, userId).map((key) => {
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (value && typeof value === "object" && typeof (value as Record<string, unknown>).integrationId === "string" &&
          /^[a-z0-9_-]{1,50}$/.test((value as { integrationId: string }).integrationId))
        return { key, integrationId: (value as { integrationId: string }).integrationId };
    } catch { /* Malformed markers remain a conservative hold. */ }
    return { key };
  });
}

export function beginHandoff(kind: string, userId: string, integrationId: string): string {
  if (handoffWarnings(kind, userId).length >= 2000) throw new Error("Handoff recovery capacity reached.");
  return beginSyncUncertainty("oauth-handoff", kind, userId, JSON.stringify({ integrationId }));
}
/** The handoff cookie is shared by all accounts on this origin. */
export function handoffLockName(): string {
  return "tflash:oauth-handoff:cookie";
}
