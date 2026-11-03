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
test("actual server hook cancels before the excess model call and persists an idempotent count", () => {
  let cancelled = 0;
  const ctx = { session: { turn: { id: "turn" }, auth: { current: { attributes: { "tflash:max-steps": "2" } } } }, cancel() { cancelled++; } };
  for (const runId of ["r0", "r0", "r1"]) hook.events["model.started"]({ data: { runId } }, ctx);
  assert.equal(cancelled, 0);
  hook.events["model.started"]({ data: { runId: "r2" } }, ctx);
  assert.equal(cancelled, 1);
  assert.deepEqual(state.steps, ["r0", "r1", "r2"]);
  ctx.session.turn.id = "next-turn";
  hook.events["model.started"]({ data: { runId: "r3" } }, ctx);
  assert.equal(cancelled, 1);
});


test("budget stop telemetry includes only bounded coordinates, not credentials or tool inputs", () => {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const ctx = { session: { turn: { id: "telemetry-turn" }, auth: { current: { attributes: { "tflash:max-steps": "1", cookie: "private-cookie-value" } } } }, cancel() {} };
    hook.events["model.started"]({ data: { runId: "r0", command: "private-command-value" } }, ctx);
    hook.events["model.started"]({ data: { runId: "r1", command: "private-command-value" } }, ctx);
    assert.match(lines.join("\n"), /model step limit reached/);
    assert.doesNotMatch(lines.join("\n"), /private-cookie-value|private-command-value/);
  } finally { console.warn = original; }
});
