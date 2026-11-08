import type { EveMessage } from "eve/react";

export function bashResultState(output: unknown): string {
  if (!output || typeof output !== "object") return "outcome-unknown";
  const value = output as Record<string, unknown>;
  if (value.status === "running") return "background-unknown";
  if (value.status === "completed" && typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode)) {
    return value.exitCode === 0 ? "output-available" : "output-error";
  }
  return "outcome-unknown";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function activityRows(
  messages: readonly EveMessage[],
  events: readonly Event[] = [],
) {
  const calls = new Map<string, { id: string; tool: string; state: string; approved?: boolean; at?: string }>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      const value = part as unknown as Record<string, unknown>;
      if (value.type !== "tool" && value.type !== "dynamic-tool") continue;
      const id = typeof value.callId === "string" ? value.callId : typeof value.toolCallId === "string" ? value.toolCallId : undefined;
      const tool = typeof value.name === "string" ? value.name : typeof value.toolName === "string" ? value.toolName : undefined;
      if (!id || !tool) continue;

      const stateName = typeof value.state === "string" ? value.state : "";
      const interaction = record(value.interaction);
      const oldApproval = record(value.approval);
      const approved = typeof oldApproval?.approved === "boolean"
        ? oldApproval.approved
        : interaction?.outcome === "accepted" ? true : interaction?.outcome === "declined" ? false : undefined;
      let state = value.type === "dynamic-tool" ? stateName :
        stateName === "streaming" ? "input-streaming" :
        stateName === "requested" || stateName === "running" ? "input-available" :
        stateName === "approval" || (stateName === "blocked" && interaction?.status !== "settled") ? "approval-requested" :
        stateName === "blocked" ? "approval-responded" :
        stateName === "completed" ? "output-available" :
        stateName === "rejected" ? "output-denied" :
        stateName === "cancelled" ? "cancelled" :
        stateName === "failed" ? "output-error" : "outcome-unknown";
      const partial = value.partial === true || stateName === "streaming";
      const output = value.output;
      const errorText = typeof value.errorText === "string" ? value.errorText : record(value.error)?.message;
      if (state === "output-available" && !partial && typeof errorText === "string" && errorText.length > 0) state = "output-error";
      // A bash tool can return a process receipt; it is not proof that the
      // command completed successfully.
      if (tool === "bash" && state === "output-available" && !partial) state = bashResultState(output);
      calls.set(id, {
        id,
        tool: tool.slice(0, 100),
        state: state === "output-available" && partial ? "running" : state,
        ...(typeof approved === "boolean" ? { approved } : {}),
      });
    }
  }

  const taskOwners = new Map<string, string>();
  const tasks = new Map<string, { state: string; at?: string }>();
  for (const event of events) {
    const data = record(event.data);
    if (!data) continue;
    const result = record(data.result);
    const taskId = typeof data.taskId === "string" ? data.taskId : event.scope?.taskId;
    const id = typeof data.callId === "string"
      ? data.callId
      : typeof result?.callId === "string"
        ? result.callId
        : taskId ? taskOwners.get(taskId) : undefined;
    if (event.type === "task.started" && taskId && id) taskOwners.set(taskId, id);
    if (!id || !calls.has(id)) continue;

    const previous = tasks.get(id);
    const at = event.meta?.at && Number.isFinite(Date.parse(event.meta.at)) ? event.meta.at : undefined;
    const row = calls.get(id)!;
    if (at && (!row.at || Date.parse(at) > Date.parse(row.at))) row.at = at;
    if (event.type === "task.started" && !previous) {
      tasks.set(id, { state: "running", at });
    } else if (event.type === "task.settled" || event.type === "task.ended") {
      const outcome = data.status ?? data.outcome;
      const state = outcome === "completed" ? (row.tool === "bash" ? bashResultState(data.output ?? data.result) : "output-available") :
        outcome === "cancelled" || outcome === "abandoned" ? "cancelled" :
          outcome === "failed" ? "output-error" : undefined;
      if (!state) continue;
      const priority: Record<string, number> = { running: 0, "output-available": 1, "background-unknown": 2, "outcome-unknown": 2, "output-error": 3, cancelled: 4 };
      if (!previous || priority[state] > priority[previous.state]) tasks.set(id, { state, at });
    }
  }
  for (const [id, task] of tasks) {
    const row = calls.get(id)!;
    row.state = task.state;
    if (task.at && (!row.at || Date.parse(task.at) > Date.parse(row.at))) row.at = task.at;
  }
  return [...calls.values()];
}

type Usage = { inputTokens?: number; outputTokens?: number; costUsd?: number };
type Event = {
  type: string;
  meta?: { id?: string; at?: string; position?: { line: number; index: number } };
  scope?: { turnId?: string; taskId?: string; callId?: string; runId?: string };
  data?: unknown;
};

/**
 * A turn outcome is not a task-completion verdict. Sequence numbers belong to
 * turns, not individual events; cancellation dominates late/duplicate events
 * for the same turn. Old streams without sequence use their original order.
 */
type TurnOutcome = "active" | "completed" | "cancelled" | "failed";
export function latestTurn(events: readonly Event[]): { turnId: string; outcome: TurnOutcome } | undefined {
  const turns = new Map<string, { sequence?: number; index: number; outcome: TurnOutcome }>();
  const ranks = { active: 0, completed: 1, failed: 2, cancelled: 3 } as const;
  events.forEach((event, index) => {
    const data = record(event.data);
    const turnId = typeof data?.turnId === "string" ? data.turnId : event.scope?.turnId;
    if (!turnId) return;
    const outcome = event.type === "turn.started" || event.type === "turn.paused" || event.type === "message.received"
      ? "active"
      : event.type === "turn.completed" || (event.type === "turn.settled" && data?.outcome === "completed")
        ? "completed"
        : event.type === "turn.cancelled" || (event.type === "turn.settled" && data?.outcome === "cancelled")
          ? "cancelled"
          : event.type === "turn.failed" || (event.type === "turn.settled" && data?.outcome === "failed")
            ? "failed"
            : undefined;
    if (!outcome) return;
    const sequence = typeof data?.sequence === "number" && Number.isSafeInteger(data.sequence) && data.sequence >= 0 ? data.sequence : undefined;
    const previous = turns.get(turnId);
    if (!previous) turns.set(turnId, { sequence, index, outcome });
    else {
      previous.index = Math.max(previous.index, index);
      if (previous.sequence === undefined) previous.sequence = sequence;
      if (ranks[outcome] > ranks[previous.outcome]) previous.outcome = outcome;
    }
  });
  let latest: { turnId: string; sequence?: number; index: number; outcome: TurnOutcome } | undefined;
  for (const [turnId, turn] of turns) {
    if (!latest || (turn.sequence !== undefined && latest.sequence !== undefined
      ? turn.sequence > latest.sequence
      : turn.index > latest.index)) latest = { turnId, ...turn };
  }
  return latest ? { turnId: latest.turnId, outcome: latest.outcome } : undefined;
}

export function latestTurnOutcome(events: readonly Event[]): TurnOutcome | undefined {
  return latestTurn(events)?.outcome;
}
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const tokenCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function readUsage(value: unknown): Usage {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    inputTokens: tokenCount(v.inputTokens),
    outputTokens: tokenCount(v.outputTokens),
    costUsd: number(v.costUsd),
  };
}
/** Prefer cumulative checkpoints and sum only identifiable usage facts.
 * A missing value makes that metric unknown, rather than presenting a partial
 * token or cost sum as a total. Replayed runs must not be counted twice.
 */
export function reportedUsage(events: readonly Event[]) {
  const keys = ["inputTokens", "outputTokens", "costUsd"] as const;
  type Metric = typeof keys[number];
  let checkpoint: Usage | undefined;
  let hasCheckpoint = false;
  const pending = new Map<string, Usage>();
  const seenSteps = new Map<string, Usage>();
  const ambiguous = new Set<Metric>();
  const ids = new Set<string>();
  for (const event of events) {
    const position = event.meta?.position;
    const eventId = event.meta?.id ?? (position ? JSON.stringify([position.line, position.index]) : undefined);
    if (eventId) {
      if (ids.has(eventId)) continue;
      ids.add(eventId);
    }
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
    if (["session.waiting", "session.failed", "session.completed", "turn.waiting"].includes(event.type)) {
      hasCheckpoint = true;
      checkpoint = readUsage(data.usage);
      pending.clear();
      ambiguous.clear();
    } else if (event.type === "usage.recorded") {
      const owner = record(data.owner);
      const ownerId = typeof owner?.runId === "string" ? `run:${owner.runId}` :
        typeof owner?.callId === "string" ? `call:${owner.callId}` :
          typeof owner?.changeId === "string" ? `change:${owner.changeId}` :
            event.meta?.id ? `event:${event.meta.id}` : position ? `position:${position.line}:${position.index}` : undefined;
      if (!ownerId) {
        keys.forEach((key) => ambiguous.add(key));
        continue;
      }
      const key = JSON.stringify(["usage", ownerId]);
      const usage = readUsage(data.usage);
      const previous = seenSteps.get(key);
      if (previous) {
        for (const metric of keys) if (previous[metric] !== usage[metric]) ambiguous.add(metric);
        continue;
      }
      seenSteps.set(key, usage);
      pending.set(key, usage);
    } else if (event.type === "step.completed") {
      if (typeof data.turnId !== "string" || !data.turnId ||
          typeof data.stepIndex !== "number" || !Number.isSafeInteger(data.stepIndex) || data.stepIndex < 0) {
        keys.forEach((key) => ambiguous.add(key));
        continue;
      }
      const key = JSON.stringify([data.turnId, data.stepIndex]);
      const step = readUsage(data.usage);
      const previous = seenSteps.get(key);
      if (previous) {
        for (const metric of keys) if (previous[metric] !== step[metric]) ambiguous.add(metric);
        continue;
      }
      seenSteps.set(key, step);
      pending.set(key, step);
    }
  }
  const result: Usage = {};
  for (const metric of keys) {
    if (ambiguous.has(metric) || (hasCheckpoint && checkpoint?.[metric] === undefined) ||
        [...pending.values()].some((step) => step[metric] === undefined)) continue;
    if (!hasCheckpoint && pending.size === 0) continue;
    let value = checkpoint?.[metric] ?? 0;
    for (const step of pending.values()) value += step[metric]!;
    if (Number.isFinite(value) && (metric === "costUsd" || Number.isSafeInteger(value))) result[metric] = value;
  }
  return result;
}
