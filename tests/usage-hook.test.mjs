import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
let state;
globalThis.__testBudgetSlot = {
  get: () => state,
  update: (fn) => { state = fn(state); },
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "eve/context") return { url: 'data:text/javascript,export function defineState(name, initial) { globalThis.__testBudgetSlot.update(() => initial()); return globalThis.__testBudgetSlot; }', shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const hook = (await import("../agent/hooks/usage-limit.ts")).default;
test("actual server hook cancels before the excess step and persists an idempotent count", () => {
  let cancelled = 0;
  const ctx = { session: { turn: { id: "turn" }, auth: { current: { attributes: { "tflash:max-steps": "2" } } } }, cancel() { cancelled++; } };
  for (const stepIndex of [0, 0, 1]) hook.events["step.started"]({ data: { stepIndex } }, ctx);
  assert.equal(cancelled, 0);
  hook.events["step.started"]({ data: { stepIndex: 2 } }, ctx);
  assert.equal(cancelled, 1);
  assert.deepEqual(state.steps, [0, 1, 2]);
  ctx.session.turn.id = "next-turn";
  hook.events["step.started"]({ data: { stepIndex: 3 } }, ctx);
  assert.equal(cancelled, 1);
});


test("budget stop telemetry includes only bounded coordinates, not credentials or tool inputs", () => {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const ctx = { session: { turn: { id: "telemetry-turn" }, auth: { current: { attributes: { "tflash:max-steps": "1", cookie: "private-cookie-value" } } } }, cancel() {} };
    hook.events["step.started"]({ data: { stepIndex: 0, command: "private-command-value" } }, ctx);
    hook.events["step.started"]({ data: { stepIndex: 1, command: "private-command-value" } }, ctx);
    assert.match(lines.join("\n"), /model step limit reached/);
    assert.doesNotMatch(lines.join("\n"), /private-cookie-value|private-command-value/);
  } finally { console.warn = original; }
});
