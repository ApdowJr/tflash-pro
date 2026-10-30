import { createClient } from "@supabase/supabase-js";
import { homepageOrigin } from "@/lib/permission-scope";
export type PermissionOwner = {
  kind: "supabase" | "vercel";
  id: string;
  sessionId: string;
};
export type WebGrant = { origin: string; expiresAt: string; revision: string };
/** Server-only service credential, never exposed to the browser or model. */
export function permissionDatabase() {
  const url =
    process.env.TFLASH_PERMISSIONS_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_TFLASH_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Permission storage is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function ownerArgs(owner: PermissionOwner) {
  return { p_kind: owner.kind, p_owner: owner.id, p_session: owner.sessionId };
}
/** Create/read a session generation before presenting a permission snapshot. */
export async function permissionEpoch(owner: PermissionOwner): Promise<string> {
  const { data, error } = await permissionDatabase().rpc("tflash_ensure_permission_epoch", ownerArgs(owner));
  if (error || typeof data !== "string") throw new Error("Permission storage unavailable.");
  return data;
}
export async function revokeAllWeb(owner: PermissionOwner): Promise<void> {
  const { data, error } = await permissionDatabase().rpc("tflash_revoke_web_grants", ownerArgs(owner));
  if (error || data !== true) throw new Error("Permission storage unavailable.");
}
/** Includes expired/revoked tombstones so a stale tab cannot recreate a grant. */
export async function listWebGrants(owner: PermissionOwner): Promise<WebGrant[]> {
  const { data, error, count } = await permissionDatabase().from("tflash_permission_grants")
    .select("origin,expires_at,revision", { count: "exact" })
    .eq("owner_kind", owner.kind).eq("owner_id", owner.id).eq("session_id", owner.sessionId)
    .order("origin").limit(1000);
  // Never treat a truncated snapshot as permission to recreate an old grant.
  if (error || count == null || count > 1000 || (data?.length ?? 0) !== count) throw new Error("Permission storage unavailable or grant limit exceeded.");
  return (data ?? []).map((r) => ({ origin: r.origin as string, expiresAt: r.expires_at as string, revision: r.revision as string }));
}
export async function hasWebGrant(owner: PermissionOwner, url: unknown): Promise<boolean> {
  const origin = homepageOrigin(url);
  if (!origin) return false;
  const { data, error } = await permissionDatabase().rpc("tflash_has_web_grant", { ...ownerArgs(owner), p_origin: origin });
  if (error || typeof data !== "boolean") throw new Error("Permission storage unavailable.");
  return data;
}
/** Atomically compare the observed session and per-origin revisions. */
export async function changeWebGrant(owner: PermissionOwner, origin: string, revision: string | null, epoch: string, revoke: boolean): Promise<boolean> {
  if (homepageOrigin(origin) !== origin || (revoke && !revision)) throw new Error("Invalid scope.");
  const { data, error } = await permissionDatabase().rpc("tflash_change_web_grant", {
    ...ownerArgs(owner), p_origin: origin, p_revision: revision, p_epoch: epoch, p_revoke: revoke,
  });
  if (error || typeof data !== "boolean") throw new Error("Permission storage unavailable.");
  return data;
}
