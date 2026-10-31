import { homepageOrigin } from "@/lib/permission-scope";
import { taskDefinitionSchema, type TrackedTask } from "@/lib/tracked-task";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (input: unknown): Record<string, unknown> | undefined => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
const validDate = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
export type GrantSnapshot = { origin: string; expiresAt: string; revision: string };
export function parsePermissionsSnapshot(input: unknown): { epoch: string; grants: GrantSnapshot[] } | undefined {
  const body = record(input);
  if (!body || typeof body.epoch !== "string" || !uuid.test(body.epoch) || !Array.isArray(body.grants) || body.grants.length > 1000) return undefined;
  const grants: GrantSnapshot[] = [], seen = new Set<string>();
  for (const candidate of body.grants) {
    const grant = record(candidate);
    if (!grant || typeof grant.origin !== "string" || homepageOrigin(grant.origin) !== grant.origin || seen.has(grant.origin) ||
        !validDate(grant.expiresAt) || typeof grant.revision !== "string" || !uuid.test(grant.revision)) return undefined;
    seen.add(grant.origin); grants.push({ origin: grant.origin, expiresAt: grant.expiresAt, revision: grant.revision });
  }
  return { epoch: body.epoch, grants };
}
export function parseTaskSnapshot(input: unknown): { task: TrackedTask | null } | undefined {
  const body = record(input);
  if (!body || !("task" in body)) return undefined;
  if (body.task === null) return { task: null };
  const task = record(body.task);
  if (!task || typeof task.revision !== "string" || !uuid.test(task.revision) ||
      (task.state !== "awaiting_evidence" && task.state !== "criterion_matched" && task.state !== "cancelled") ||
      (task.verifiedAt !== null && !validDate(task.verifiedAt)) ||
      (task.reason !== null && (typeof task.reason !== "string" || task.reason.length > 4000))) return undefined;
  const definition = taskDefinitionSchema.safeParse({ objective: task.objective, path: task.path, sha256: task.sha256, continuationBudget: task.continuationBudget });
  if (!definition.success) return undefined;
  return { task: { ...definition.data, revision: task.revision, state: task.state, verifiedAt: task.verifiedAt as string | null, reason: task.reason as string | null } };
}
