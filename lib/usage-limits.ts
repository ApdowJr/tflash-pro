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
/** Pure transition used by the durable hook; replay of the same step is idempotent. */
export function countModelStep(
  state: { turnId: string; steps: readonly number[] },
  turnId: string,
  stepIndex: number,
  cap: number,
) {
  const previous = state.turnId === turnId ? state.steps : [];
  const steps = previous.includes(stepIndex)
    ? previous
    : [...previous, stepIndex];
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
