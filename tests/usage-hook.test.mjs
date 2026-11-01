import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "eve/events") return { url: 'data:text/javascript,export function runs(view, { turnId } = {}) { const count = Math.max(0, view?.runsByTurn?.[turnId] ?? 0); return Array.from({ length: count }, (_, index) => ({ runId: String(index) })); }', shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const hook = (await import("../agent/hooks/usage-limit.ts")).default;

test("server hook uses the durable per-turn run count and cancels before an excess model call", () => {
  let cancelled = 0;
  const ctx = {
    view: { runsByTurn: { turn: 0 } },
    session: { auth: { current: { attributes: { "tflash:max-steps": "2" } } } },
    cancel() { cancelled++; },
  };
  for (const runCount of [1, 2]) {
    ctx.view.runsByTurn.turn = runCount;
    hook.events["model.requested"]({ scope: { turnId: "turn" }, data: { runId: `run-${runCount}`, owner: { turnId: "turn" } } }, ctx);
  }
  assert.equal(cancelled, 0);
  ctx.view.runsByTurn.turn = 3;
  hook.events["model.requested"]({ scope: { turnId: "turn" }, data: { runId: "run-3", owner: { turnId: "turn" } } }, ctx);
  assert.equal(cancelled, 1);
  ctx.view.runsByTurn["next-turn"] = 1;
  hook.events["model.requested"]({ scope: { turnId: "next-turn" }, data: { runId: "next-run", owner: { turnId: "next-turn" } } }, ctx);
  assert.equal(cancelled, 1);
});


test("budget-stop telemetry contains bounded coordinates, not credentials or tool inputs", () => {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    const ctx = {
      view: { runsByTurn: { "telemetry-turn": 1 } },
      session: { auth: { current: { attributes: { "tflash:max-steps": "1", cookie: "private-cookie-value" } } } },
      cancel() {},
    };
    hook.events["model.requested"]({ scope: { turnId: "telemetry-turn" }, data: { runId: "run-one", owner: { turnId: "telemetry-turn" }, command: "private-command-value" } }, ctx);
    ctx.view.runsByTurn["telemetry-turn"] = 2;
    hook.events["model.requested"]({ scope: { turnId: "telemetry-turn" }, data: { runId: "run-two", owner: { turnId: "telemetry-turn" }, command: "private-command-value" } }, ctx);
    assert.match(lines.join("\n"), /model call limit reached/);
    assert.doesNotMatch(lines.join("\n"), /private-cookie-value|private-command-value/);
  } finally { console.warn = original; }
});
