import { permissionDatabase, type PermissionOwner } from "@/lib/permission-store";
import { waitWithAbort } from "@/lib/abortable";

type Attempt = { attemptId: string; state: "reserved" | "dispatching"; createdAt: string; reviewRevision: string; holdNote: string | null; holdAt: string | null };
const args = (owner: PermissionOwner) => ({ p_kind: owner.kind, p_owner: owner.id, p_session: owner.sessionId });
function deadline(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(5_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export async function pendingContinuation(owner: PermissionOwner, abortSignal?: AbortSignal): Promise<Attempt | null> {
  const signal = deadline(abortSignal); signal.throwIfAborted();
  const query = permissionDatabase().from("tflash_task_continuation_attempts")
    .select("attempt_id,state,created_at,review_revision,hold_note,hold_at").eq("owner_kind", owner.kind).eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId).in("state", ["reserved", "dispatching"]).abortSignal(signal).maybeSingle();
  const { data, error } = await waitWithAbort(query, signal);
  signal.throwIfAborted();
  if (error) throw new Error("Continuation storage unavailable.");
  if (!data) return null;
  if (typeof data.attempt_id !== "string" || !["reserved", "dispatching"].includes(data.state) || typeof data.created_at !== "string" || typeof data.review_revision !== "string" || (data.hold_note !== null && typeof data.hold_note !== "string") || (data.hold_at !== null && typeof data.hold_at !== "string")) throw new Error("Invalid continuation record.");
  return { attemptId: data.attempt_id, state: data.state, createdAt: data.created_at, reviewRevision: data.review_revision, holdNote: data.hold_note, holdAt: data.hold_at } as Attempt;
}
export async function reviewedContinuations(owner: PermissionOwner, abortSignal?: AbortSignal): Promise<{ attemptId: string; reviewedAt: string; note: string }[]> {
  const signal = deadline(abortSignal); signal.throwIfAborted();
  const query = permissionDatabase().from("tflash_task_continuation_attempts")
    .select("attempt_id,reviewed_at,review_note").eq("owner_kind", owner.kind).eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId).eq("state", "reviewed").order("reviewed_at", { ascending: false }).limit(20).abortSignal(signal);
  const { data, error } = await waitWithAbort(query, signal); signal.throwIfAborted();
  if (error || !Array.isArray(data) || data.length > 20) throw new Error("Continuation history unavailable.");
  return data.map((row) => {
    if (typeof row.attempt_id !== "string" || typeof row.reviewed_at !== "string" || typeof row.review_note !== "string" || row.review_note.length > 1000) throw new Error("Invalid continuation history.");
    return { attemptId: row.attempt_id, reviewedAt: row.reviewed_at, note: row.review_note };
  });
}
export async function continuationMutation(owner: PermissionOwner, action: "reserve" | "begin" | "hold" | "resolve", attemptId: string, revision?: string, note?: string, abortSignal?: AbortSignal): Promise<boolean> {
  const signal = deadline(abortSignal); signal.throwIfAborted();
  const query = permissionDatabase().rpc(`tflash_${action}_continuation`, {
    ...args(owner), p_attempt: attemptId, ...(action === "reserve" ? { p_revision: revision } : {}), ...(action === "hold" || action === "resolve" ? { p_expected: revision, p_note: note } : {}),
  }).abortSignal(signal);
  const { data, error } = await waitWithAbort(query, signal);
  signal.throwIfAborted();
  if (error || typeof data !== "boolean") throw new Error("Continuation storage unavailable.");
  return data;
}
