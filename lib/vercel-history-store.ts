import "server-only";
import { createClient } from "@supabase/supabase-js";
import { waitWithAbort } from "@/lib/abortable";
import { signChatOwnership } from "@/lib/security/chat-ownership";

/** Explicit opt-in. A partially configured deployment fails closed. */
export function vercelHistoryEnabled() { return process.env.TFLASH_VERCEL_HISTORY_SYNC === "1"; }
function database() {
  const url = process.env.TFLASH_VERCEL_HISTORY_SUPABASE_URL;
  const key = process.env.TFLASH_VERCEL_HISTORY_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Vercel history is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export type LocalHistoryEntry = { id: string; title: string; updatedAt: number; proof: string };
export async function listVercelHistory(owner: string) {
  const signal = AbortSignal.timeout(5_000);
  const query = database().from("tflash_vercel_chats").select("session_id,title,updated_at")
    .eq("owner_id",owner).is("deleted_at",null).not("title","is",null)
    .order("updated_at",{ascending:false}).order("session_id").limit(100).abortSignal(signal);
  const {data,error} = await waitWithAbort(query,signal);
  if (error || !Array.isArray(data)) throw new Error("Vercel history unavailable.");
  return data.map(row => {
    const timestamp=Date.parse(row.updated_at);
    if (typeof row.session_id !== "string" || typeof row.title !== "string" || !Number.isFinite(timestamp)) throw new Error("Invalid Vercel history.");
    return { id:row.session_id,title:row.title,updatedAt:timestamp,proof:signChatOwnership(owner,row.session_id) };
  });
}
async function rpc(name: string, args: Record<string,unknown>) {
  const signal=AbortSignal.timeout(5_000);
  const {data,error}=await waitWithAbort(database().rpc(name,args).abortSignal(signal),signal);
  if (error) throw new Error("Vercel history unavailable.");
  return data;
}
export async function importVercelHistory(owner: string, chats: LocalHistoryEntry[]) {
  const data=await rpc("tflash_vercel_history_import",{p_owner:owner,p_chats:chats.map(({id,title,updatedAt})=>({id,title,updatedAt}))});
  if (typeof data !== "number") throw new Error("Vercel history unavailable.");
}
export async function updateVercelHistory(owner: string, session: string, title: string, activity: boolean) {
  const data=await rpc("tflash_vercel_history_update",{p_owner:owner,p_session:session,p_title:title,p_activity:activity});
  if (data !== null && typeof data !== "string") throw new Error("Vercel history unavailable.");
  return data as string | null;
}
export async function removeVercelHistory(owner: string, session: string) {
  const data=await rpc("tflash_vercel_history_remove",{p_owner:owner,p_session:session});
  if (typeof data !== "boolean") throw new Error("Vercel history unavailable.");
  return data;
}
