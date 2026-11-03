export const HEADER_MAX_STEPS = "x-tflash-max-steps";
export const ATTR_MAX_STEPS = "tflash:max-steps";
export function modelStepLimit(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 30
    ? value
    : 12;
}
/**
 * Counts distinct model runs in a turn. eve emits `model.started` once per run
 * attempt, so the run id — not the attempt number — is the step identity and
 * replaying the same run is idempotent.
 */
export function countModelStep(
  state: { turnId: string; steps: readonly string[] },
  turnId: string,
  runId: string,
  cap: number,
) {
  const previous = state.turnId === turnId ? state.steps : [];
  const steps = previous.includes(runId) ? previous : [...previous, runId];
  return { state: { turnId, steps }, cancel: steps.length > cap };
}
type UsageWindow = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd?: number;
};
export function modelUsageWindowReached({
  window,
}: {
  window: UsageWindow;
}): boolean {
  return (
    window.inputTokens - window.cacheReadTokens >= 250_000 ||
    window.outputTokens >= 30_000 ||
    (window.costUsd !== undefined && window.costUsd >= 2)
  );
}
