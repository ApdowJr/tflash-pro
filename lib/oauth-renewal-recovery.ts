import { beginSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

export type RenewalMarker = { readonly key: string; readonly integrationId?: string; readonly fingerprint?: string; readonly state: "pending" | "settled" };

/** Hash the sealed ciphertext, never the provider's plaintext credential. */
export async function renewalFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function renewalMarkers(kind: string, userId: string): RenewalMarker[] {
  return syncUncertaintyMarkers("oauth-refresh", kind, userId).map((key) => {
    const value = window.localStorage.getItem(key);
    try {
      const entry: unknown = JSON.parse(value ?? "null");
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        if (typeof record.integrationId === "string" && /^[a-z0-9_-]{1,50}$/.test(record.integrationId) &&
            typeof record.fingerprint === "string" && /^[a-f0-9]{64}$/.test(record.fingerprint) &&
            (record.state === "pending" || record.state === "settled")) {
          return { key, integrationId: record.integrationId, fingerprint: record.fingerprint, state: record.state };
        }
      }
    } catch { /* Malformed records remain a conservative, account-wide hold. */ }
    return { key, state: "pending" };
  });
}

/** Never discard a settled marker: it prevents replay of an older browser copy. */
export function beginRenewal(kind: string, userId: string, integrationId: string, fingerprint: string): string {
  const records = renewalMarkers(kind, userId);
  if (records.length >= 2000) throw new Error("Renewal recovery capacity reached.");
  return beginSyncUncertainty("oauth-refresh", kind, userId, JSON.stringify({ integrationId, fingerprint, state: "pending" }));
}

export function settleRenewal(marker: RenewalMarker): void {
  if (!marker.integrationId || !marker.fingerprint) throw new Error("Invalid renewal marker.");
  window.localStorage.setItem(marker.key, JSON.stringify({ integrationId: marker.integrationId, fingerprint: marker.fingerprint, state: "settled" }));
}

export function renewalLockName(kind: string, userId: string, integrationId: string): string {
  return `tflash:oauth-refresh:${encodeURIComponent(kind)}:${encodeURIComponent(userId)}:${encodeURIComponent(integrationId)}`;
}
