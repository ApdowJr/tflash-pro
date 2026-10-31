import "server-only";
import { createClient } from "@supabase/supabase-js";
import { waitWithAbort } from "@/lib/abortable";
import type { Workspace } from "@/lib/workspace";

/** Disabled unless deliberately enabled; missing credentials fail closed. */
export function vercelWorkspaceEnabled() { return process.env.TFLASH_VERCEL_WORKSPACE_SYNC === "1"; }
function database() {
  const url = process.env.TFLASH_VERCEL_WORKSPACE_SUPABASE_URL;
  const key = process.env.TFLASH_VERCEL_WORKSPACE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Vercel workspace sync is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function readVercelWorkspace(owner: string) {
  const signal = AbortSignal.timeout(5_000);
  const query = database().from("tflash_vercel_workspaces").select("workspace,updated_at")
    .eq("owner_id", owner).abortSignal(signal).maybeSingle();
  const { data, error } = await waitWithAbort(query, signal);
  if (error) throw new Error("Workspace unavailable.");
  return data;
}
export async function writeVercelWorkspace(owner: string, workspace: Workspace, expected: string | null, updatedAt: string) {
  const signal = AbortSignal.timeout(5_000);
  const table = database().from("tflash_vercel_workspaces");
  if (expected === null) {
    const { error } = await waitWithAbort(table.insert({ owner_id: owner, workspace, updated_at: updatedAt }).abortSignal(signal), signal);
    if (error?.code === "23505") return false;
    if (error) throw new Error("Workspace unavailable.");
    return true;
  }
  const { data, error } = await waitWithAbort(table.update({ workspace, updated_at: updatedAt })
    .eq("owner_id", owner).eq("updated_at", expected).select("updated_at").abortSignal(signal).maybeSingle(), signal);
  if (error) throw new Error("Workspace unavailable.");
  return !!data;
}
