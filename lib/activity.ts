import type { EveMessage, EveToolPart } from "eve/react";
import { APPROVE_OPTION_ID, DENY_OPTION_ID } from "eve/events";

export function bashResultState(output: unknown): string {
  if (!output || typeof output !== "object") return "outcome-unknown";
  const value = output as Record<string, unknown>;
  if (value.status === "running") return "background-unknown";
  if (value.status === "completed" && typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode)) {
    return value.exitCode === 0 ? "output-available" : "output-error";
  }
  return "outcome-unknown";
}

type Row = { id: string; tool: string; state: string; approved?: boolean; at?: string };

/**
 * Map a v1 call to the row states the activity panel knows. The panel's
 * vocabulary predates v1, so keep it stable while reading the shared call
 * state: an interrupted call reads as cancelled, and a bash result is only a
 * success when its exit code says so.
 */
function rowForPart(part: EveToolPart): Row {
  const interaction = part.interaction;
  const answer = interaction?.answer;
  let state: string;
  switch (part.state) {
    case "streaming":
    case "requested":
    case "running":
    case "blocked":
      state = "running";
      break;
    case "approval":
      state = answer !== undefined ? "approval-responded" : "approval-requested";
      break;
    case "completed":
      state = part.name === "bash" ? bashResultState(part.output) : "output-available";
      break;
    case "failed":
      state = "output-error";
      break;
    case "rejected":
      state = "output-denied";
      break;
    case "cancelled":
      state = "cancelled";
      break;
  }
  let approved: boolean | undefined;
  if (interaction?.request.kind === "approval") {
    if (interaction.outcome === "accepted") approved = true;
    else if (interaction.outcome === "declined") approved = false;
    else if (answer?.optionId === APPROVE_OPTION_ID) approved = true;
    else if (answer?.optionId === DENY_OPTION_ID) approved = false;
  }
  return {
    id: part.callId,
    tool: part.name.slice(0, 100),
    state,
    ...(approved === undefined ? {} : { approved }),
  };
}

export function activityRows(
  messages: readonly EveMessage[],
  events: readonly Event[] = [],
) {
  const calls = new Map<string, Row>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      calls.set(part.callId, rowForPart(part));
    }
  }
  // A task's call can outlive its own settled receipt when the tool returns a
  // receipt and lets a background process continue. Its unique callId stays
  // running until the task ends, even when a reconnect replays task.started
  // after the end. Never let an old start undo a terminal outcome.
  const tasks = new Map<string, { state: string; at?: string }>();
  const taskCalls = new Map<string, string>();
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    const startedBy = data.startedBy && typeof data.startedBy === "object"
      ? data.startedBy as Record<string, unknown>
      : undefined;
    const startedCall = typeof startedBy?.callId === "string" ? startedBy.callId : undefined;
    if (event.type === "task.started" && typeof data.taskId === "string" && startedCall) {
      taskCalls.set(data.taskId, startedCall);
    }
    const id = typeof data.callId === "string" ? data.callId
      : typeof data.taskId === "string" ? taskCalls.get(data.taskId)
        : event.type === "task.started" ? startedCall : undefined;
    if (!id || !calls.has(id)) continue;
    const previous = tasks.get(id);
    const at = event.meta?.at && Number.isFinite(Date.parse(event.meta.at)) ? event.meta.at : undefined;
    const row = calls.get(id)!;
    if (at && (!row.at || Date.parse(at) > Date.parse(row.at))) row.at = at;
    if (event.type === "task.started" && !previous) {
      tasks.set(id, { state: "running", at });
    } else if (event.type === "task.ended") {
      const state = data.outcome === "cancelled" ? "cancelled" :
        data.outcome === "failed" ? "output-error" :
        data.outcome === "completed" ? (row.tool === "bash" ? "outcome-unknown" : "output-available") : undefined;
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
  scope?: { turnId?: string; taskId?: string; runId?: string; changeId?: string };
  meta?: {
    id?: string;
    at?: string;
    position?: { line: number; index: number };
  };
  data?: unknown;
};

/**
 * A turn outcome is not a task-completion verdict. Turn facts arrive in stream
 * order, and cancellation dominates late or duplicate facts for the same turn.
 * A delivery consumed by a turn also keeps the turn active, but cannot undo a
 * settlement.
 */
type TurnOutcome = "active" | "completed" | "cancelled" | "failed";
export function latestTurn(events: readonly Event[]): { turnId: string; outcome: TurnOutcome } | undefined {
  const turns = new Map<string, { order: number; outcome: TurnOutcome }>();
  const ranks = { active: 0, completed: 1, failed: 2, cancelled: 3 } as const;
  let order = 0;
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (typeof data.turnId !== "string") continue;
    const outcome: TurnOutcome | undefined =
      event.type === "turn.started" || event.type === "turn.paused" ||
        event.type === "delivery.consumed" ? "active" :
        event.type === "turn.settled" &&
          (data.outcome === "completed" || data.outcome === "cancelled" || data.outcome === "failed")
          ? data.outcome : undefined;
    if (!outcome) continue;
    const previous = turns.get(data.turnId);
    if (!previous) turns.set(data.turnId, { order: order++, outcome });
    else if (ranks[outcome] > ranks[previous.outcome]) previous.outcome = outcome;
  }
  let latest: { turnId: string; order: number; outcome: TurnOutcome } | undefined;
  for (const [turnId, turn] of turns) {
    if (!latest || turn.order > latest.order) latest = { turnId, ...turn };
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
/**
 * Sums the session's incremental `usage.recorded` facts. A missing value makes
 * that metric unknown, rather than presenting a partial token or cost sum as a
 * total. Replayed facts must not be counted twice: v1 identifies a fact by its
 * stream position, and older fixtures may still carry an event id.
 */
export function reportedUsage(events: readonly Event[]) {
  const keys = ["inputTokens", "outputTokens", "costUsd"] as const;
  type Metric = typeof keys[number];
  const totals: Usage = {};
  const ambiguous = new Set<Metric>();
  const seen = new Set<string>();
  let counted = false;
  for (const event of events) {
    if (event.type !== "usage.recorded") continue;
    const position = event.meta?.position;
    const identity = position ? `${position.line}:${position.index}` : event.meta?.id;
    if (identity !== undefined) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
    const usage = readUsage(data.usage);
    if (!data.usage || typeof data.usage !== "object") {
      keys.forEach((key) => ambiguous.add(key));
      continue;
    }
    counted = true;
    for (const metric of keys) {
      const value = usage[metric];
      if (value === undefined) {
        ambiguous.add(metric);
        continue;
      }
      totals[metric] = (totals[metric] ?? 0) + value;
    }
  }
  if (!counted) return {};
  const result: Usage = {};
  for (const metric of keys) {
    if (ambiguous.has(metric)) continue;
    const value = totals[metric];
    if (value === undefined) continue;
    if (Number.isFinite(value) && (metric === "costUsd" || Number.isSafeInteger(value))) result[metric] = value;
  }
  return result;
}
