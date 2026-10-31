import type { EveMessage } from "eve/react";

function bashResultState(output: unknown): string {
  if (!output || typeof output !== "object") return "outcome-unknown";
  const value = output as Record<string, unknown>;
  if (value.status === "running") return "background-unknown";
  if (value.status === "completed" && typeof value.exitCode === "number") {
    return value.exitCode === 0 ? "output-available" : "output-error";
  }
  return "outcome-unknown";
}

export function activityRows(
  messages: readonly EveMessage[],
  events: readonly Event[] = [],
) {
  const calls = new Map<
    string,
    { id: string; tool: string; state: string; approved?: boolean; at?: string }
  >();
  for (const message of messages)
    if (message.role === "assistant") {
      for (const part of message.parts)
        if (part.type === "dynamic-tool") {
          let state: string = part.state === "output-available" && part.partial ? "running" : part.state;
          // Eve's bash executor returns an ordinary tool result even when a
          // process is still running or completed with a nonzero exit code.
          // Neither is evidence that the command succeeded.
          if (part.toolName === "bash" && part.state === "output-available" && !part.partial) {
            state = bashResultState(part.output);
          }
          calls.set(part.toolCallId, {
            id: part.toolCallId,
            tool: part.toolName.slice(0, 100),
            state,
            ...(typeof part.approval?.approved === "boolean"
              ? { approved: part.approval.approved }
              : {}),
          });
        }
    }
  // A task's action.result can be only a receipt. Its unique callId stays
  // running until task.settled, even when a reconnect replays task.started
  // after the settlement. Never let an old start undo a terminal outcome.
  const tasks = new Map<string, { state: string; at?: string }>();
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    const result = data.result && typeof data.result === "object" ? data.result as Record<string, unknown> : undefined;
    const id = typeof data.callId === "string" ? data.callId : typeof result?.callId === "string" ? result.callId : undefined;
    if (!id || !calls.has(id)) continue;
    const previous = tasks.get(id);
    const at = event.meta?.at && Number.isFinite(Date.parse(event.meta.at)) ? event.meta.at : undefined;
    const row = calls.get(id)!;
    if (at && (!row.at || Date.parse(at) > Date.parse(row.at))) row.at = at;
    if (event.type === "task.started" && !previous) {
      tasks.set(id, { state: "running", at });
    } else if (event.type === "task.settled") {
      const state = data.status === "completed" ? (row.tool === "bash" ? bashResultState(data.output) : "output-available") :
        data.status === "cancelled" ? "cancelled" : data.status === "failed" ? "output-error" : undefined;
      if (!state) continue;
      // If inconsistent duplicate terminal events are observed, cancellation
      // and failure take precedence over success rather than inventing success.
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
  meta?: { id?: string; at?: string };
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
    const outcome = event.type === "turn.started" || event.type === "message.received" ? "active" :
      event.type === "turn.completed" ? "completed" : event.type === "turn.cancelled" ? "cancelled" :
        event.type === "turn.failed" ? "failed" : undefined;
    if (!outcome || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (typeof data.turnId !== "string") return;
    const sequence = typeof data.sequence === "number" && Number.isSafeInteger(data.sequence) && data.sequence >= 0 ? data.sequence : undefined;
    const previous = turns.get(data.turnId);
    if (!previous) turns.set(data.turnId, { sequence, index, outcome });
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
function readUsage(value: unknown): Usage {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    inputTokens: number(v.inputTokens),
    outputTokens: number(v.outputTokens),
    costUsd: number(v.costUsd),
  };
}
/** Prefer Eve's cumulative checkpoints, then add new own-session steps only.
 * If a checkpoint or any later step lacks a cost, the total is unknown.
 * Never present a partial sum as the total or invent prices.
 */
export function reportedUsage(events: readonly Event[]) {
  let usage: Usage = {};
  let hasCheckpoint = false;
  let missingCheckpointUsage = false;
  const steps = new Map<string, Usage>();
  const ids = new Set<string>();
  for (const event of events) {
    if (event.meta?.id) {
      if (ids.has(event.meta.id)) continue;
      ids.add(event.meta.id);
    }
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
    if (
      [
        "session.waiting",
        "session.failed",
        "session.completed",
        "turn.waiting",
      ].includes(event.type)
    ) {
      hasCheckpoint = true;
      if (data.usage) {
        usage = readUsage(data.usage);
        missingCheckpointUsage = false;
        steps.clear();
      } else {
        // Keep known tokens, but a checkpoint without usage cannot establish
        // the cumulative cost even if earlier or later steps report prices.
        missingCheckpointUsage = true;
      }
    } else if (event.type === "step.completed") {
      const key = `${data.turnId}:${data.stepIndex}`;
      steps.set(key, readUsage(data.usage));
    }
  }
  const costUnknown = missingCheckpointUsage || (hasCheckpoint && usage.costUsd === undefined) ||
    [...steps.values()].some((step) => step.costUsd === undefined);
  for (const step of steps.values())
    for (const key of ["inputTokens", "outputTokens", "costUsd"] as const) {
      if (step[key] !== undefined) usage[key] = (usage[key] ?? 0) + step[key];
    }
  if (costUnknown) delete usage.costUsd;
  return usage;
}
