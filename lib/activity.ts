import type { EveMessage } from "eve/react";

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
          const state =
            part.state === "output-available" && part.partial
              ? "running"
              : part.state;
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
  for (const event of events) {
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    const result =
      data.result && typeof data.result === "object"
        ? (data.result as Record<string, unknown>)
        : undefined;
    const id =
      typeof data.callId === "string"
        ? data.callId
        : typeof result?.callId === "string"
          ? result.callId
          : undefined;
    const row = id ? calls.get(id) : undefined;
    if (!row) continue;
    if (event.meta?.at && Number.isFinite(Date.parse(event.meta.at)))
      row.at = event.meta.at;
    if (event.type === "task.started") row.state = "running";
    if (event.type === "task.settled")
      row.state =
        data.status === "completed"
          ? "output-available"
          : data.status === "cancelled"
            ? "cancelled"
            : "output-error";
  }
  return [...calls.values()];
}

type Usage = { inputTokens?: number; outputTokens?: number; costUsd?: number };
type Event = {
  type: string;
  meta?: { id?: string; at?: string };
  data?: unknown;
};
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
 * A sum of reported costs is partial if some steps have no cost. Never invent prices.
 */
export function reportedUsage(events: readonly Event[]) {
  let usage: Usage = {};
  const steps = new Map<string, Usage>();
  const ids = new Set<string>();
  for (const event of events) {
    if (event.meta?.id) {
      if (ids.has(event.meta.id)) continue;
      ids.add(event.meta.id);
    }
    if (!event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;
    if (
      [
        "session.waiting",
        "session.failed",
        "session.completed",
        "turn.waiting",
      ].includes(event.type) &&
      data.usage
    ) {
      usage = readUsage(data.usage);
      steps.clear();
    } else if (event.type === "step.completed") {
      const key = `${data.turnId}:${data.stepIndex}`;
      steps.set(key, readUsage(data.usage));
    }
  }
  for (const step of steps.values())
    for (const key of ["inputTokens", "outputTokens", "costUsd"] as const) {
      if (step[key] !== undefined) usage[key] = (usage[key] ?? 0) + step[key];
    }
  return usage;
}
