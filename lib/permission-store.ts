import { randomUUID } from "node:crypto";
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
function query(owner: PermissionOwner) {
  return permissionDatabase()
    .from("tflash_permission_grants")
    .select("origin,expires_at,revision")
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId);
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
export async function hasWebGrant(
  owner: PermissionOwner,
  url: unknown,
): Promise<boolean> {
  const origin = homepageOrigin(url);
  if (!origin) return false;
  const { data, error } = await query(owner)
    .eq("origin", origin)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error("Permission storage unavailable.");
  return !!data;
}
/** All changes are conditional on the version shown to the user. */
export async function changeWebGrant(owner: PermissionOwner, origin: string, revision: string | null, revoke: boolean): Promise<boolean> {
  if (homepageOrigin(origin) !== origin || (revoke && !revision)) throw new Error("Invalid scope.");
  const values = { revision: randomUUID(), expires_at: revoke ? "1970-01-01T00:00:00.000Z" : new Date(Date.now() + 3600_000).toISOString() };
  const table = permissionDatabase().from("tflash_permission_grants");
  if (revision === null) {
    const { error } = await table.insert({ owner_kind: owner.kind, owner_id: owner.id, session_id: owner.sessionId, origin, ...values });
    if (error?.code === "23505") return false;
    if (error) throw new Error("Permission storage unavailable.");
    return true;
  }
  const { data, error } = await table.update(values).eq("owner_kind", owner.kind).eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId).eq("origin", origin).eq("revision", revision).select("revision").maybeSingle();
  if (error) throw new Error("Permission storage unavailable.");
  return !!data;
}
