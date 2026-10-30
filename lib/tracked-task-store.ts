import { randomUUID } from "node:crypto";
import {
  permissionDatabase,
  type PermissionOwner,
} from "@/lib/permission-store";
import {
  taskDefinitionSchema,
  type TaskDefinition,
  type TrackedTask,
} from "@/lib/tracked-task";
function scoped(owner: PermissionOwner) {
  return permissionDatabase()
    .from("tflash_tracked_tasks")
    .select(
      "revision,objective,path,sha256,continuation_budget,state,verified_at,reason",
    )
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId);
}
export async function getTask(
  owner: PermissionOwner,
): Promise<TrackedTask | null> {
  const { data, error } = await scoped(owner).maybeSingle();
  if (error) throw new Error("Task storage unavailable.");
  if (!data) return null;
  const parsed = taskDefinitionSchema.safeParse({
    objective: data.objective,
    path: data.path,
    sha256: data.sha256,
    continuationBudget: data.continuation_budget,
  });
  if (
    !parsed.success ||
    typeof data.revision !== "string" ||
    !["awaiting_evidence", "criterion_matched", "cancelled"].includes(
      data.state,
    )
  )
    throw new Error("Invalid stored task.");
  return {
    ...parsed.data,
    revision: data.revision,
    state: data.state,
    verifiedAt: data.verified_at,
    reason: data.reason,
  } as TrackedTask;
}
/** Replace only the version the user actually reviewed. */
export async function setTask(owner: PermissionOwner, input: TaskDefinition, expectedRevision: string | null): Promise<boolean> {
  const p = taskDefinitionSchema.parse(input);
  const values = {
    revision: randomUUID(), objective: p.objective, path: p.path, sha256: p.sha256,
    continuation_budget: p.continuationBudget, state: "awaiting_evidence",
    verified_at: null, reason: null,
  };
  const table = permissionDatabase().from("tflash_tracked_tasks");
  if (expectedRevision === null) {
    const { error } = await table.insert({ owner_kind: owner.kind, owner_id: owner.id, session_id: owner.sessionId, ...values });
    if (error?.code === "23505") return false;
    if (error) throw new Error("Task storage unavailable.");
    return true;
  }
  const { data, error } = await table.update(values)
    .eq("owner_kind", owner.kind).eq("owner_id", owner.id).eq("session_id", owner.sessionId)
    .eq("revision", expectedRevision).select("revision").maybeSingle();
  if (error) throw new Error("Task storage unavailable.");
  return !!data;
}
/** Revision and state CAS protects against cancellation or replacement during verification. */
export async function settleTask(
  owner: PermissionOwner,
  revision: string,
  state: "criterion_matched" | "awaiting_evidence" | "cancelled",
  reason: string | null,
): Promise<boolean> {
  const { data, error } = await permissionDatabase()
    .from("tflash_tracked_tasks")
    .update({
      revision: randomUUID(),
      state,
      reason,
      verified_at:
        state === "criterion_matched" ? new Date().toISOString() : null,
    })
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("session_id", owner.sessionId)
    .eq("revision", revision)
    .in("state", ["awaiting_evidence", "criterion_matched"])
    .select("revision")
    .maybeSingle();
  if (error) throw new Error("Task storage unavailable.");
  return !!data;
}
