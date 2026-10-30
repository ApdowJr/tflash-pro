import { createClient } from "@supabase/supabase-js";
import { homepageOrigin } from "@/lib/permission-scope";
export type PermissionOwner = {
  kind: "supabase" | "vercel";
  id: string;
  sessionId: string;
};
export type WebGrant = { origin: string; expiresAt: string };
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
    .select("origin,expires_at")
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId);
}
export async function listWebGrants(
  owner: PermissionOwner,
): Promise<WebGrant[]> {
  const { data, error } = await query(owner)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at");
  if (error) throw new Error("Permission storage unavailable.");
  return (data ?? []).map((r) => ({
    origin: r.origin as string,
    expiresAt: r.expires_at as string,
  }));
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
export async function grantWeb(owner: PermissionOwner, origin: string) {
  if (homepageOrigin(origin) !== origin) throw new Error("Invalid scope.");
  const { error } = await permissionDatabase()
    .from("tflash_permission_grants")
    .upsert(
      {
        owner_kind: owner.kind,
        owner_id: owner.id,
        session_id: owner.sessionId,
        origin,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      { onConflict: "owner_kind,owner_id,session_id,origin" },
    );
  if (error) throw new Error("Permission storage unavailable.");
}
export async function revokeWeb(owner: PermissionOwner, origin: string) {
  if (homepageOrigin(origin) !== origin) throw new Error("Invalid scope.");
  const { error } = await permissionDatabase()
    .from("tflash_permission_grants")
    .delete()
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId)
    .eq("origin", origin);
  if (error) throw new Error("Permission storage unavailable.");
}
