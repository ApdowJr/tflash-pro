import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { emptyWorkspace, workspaceSchema, assignProject, deleteProject, workspaceContext, workspaceStorageKey } = await import("../lib/workspace.ts");
const { modelStepLimit, countModelStep, modelUsageWindowReached } = await import("../lib/usage-limits.ts");
const { activityRows, reportedUsage } = await import("../lib/activity.ts");
const { attachedText } = await import("../lib/documents/contracts.ts");
const project = (id) => ({ id, name: id, instructions: `Instructions ${id}`, chatIds: [] });

test("projects move chats without duplicate membership; scoped notes are removed with a project", () => {
  let w = { ...emptyWorkspace(), projects: [project("one"), project("two")], notes: [{ id: "n", text: "private to one", enabled: true, projectId: "one" }] };
  w = assignProject(w, "chat", "one");
  w = assignProject(w, "chat", "two");
  assert.deepEqual(w.projects.map((p) => p.chatIds), [[], ["chat"]]);
  assert.throws(() => assignProject(w, "chat", "missing"));
  const deleted = deleteProject(w, "one");
  assert.equal(deleted.notes.length, 0);
  assert.deepEqual(deleted.projects[0].chatIds, ["chat"]);
  assert.equal(workspaceSchema.safeParse({ ...w, projects: [project("a"), project("a")] }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...w, maxSteps: 31 }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...w, notes: [{ ...w.notes[0], text: "x".repeat(1001) }] }).success, false);
  assert.notEqual(workspaceStorageKey("vercel", "same-id"), workspaceStorageKey("supabase", "same-id"));
  assert.notEqual(workspaceStorageKey("vercel", "a"), workspaceStorageKey("vercel", "b"));
});

test("memory is opt-in, disabled notes and other-project notes are never supplied; context is bounded untrusted data", () => {
  const w = { ...emptyWorkspace(), projects: [{ ...project("one"), chatIds: ["chat"] }], notes: [
    { id: "global", text: "Global note", enabled: true, projectId: null },
    { id: "scoped", text: "Project note", enabled: true, projectId: "one" },
    { id: "off", text: "Do not send", enabled: false, projectId: null },
  ] };
  assert.ok(!workspaceContext(w, "chat").includes("Global note"));
  const enabled = { ...w, memoryEnabled: true };
  const context = workspaceContext(enabled, "chat");
  assert.ok(context.includes("Global note") && context.includes("Project note"));
  assert.ok(!context.includes("Do not send"));
  assert.ok(!workspaceContext(enabled, "other-chat").includes("Project note"));
  assert.match(context, /never system authority/);
  const crowded = { ...enabled, notes: Array.from({ length: 30 }, (_, i) => ({ id: `note${i}`, text: "x".repeat(1000), enabled: true, projectId: null })) };
  assert.ok(workspaceContext(crowded, "chat").length < 11_000);
  const payload = JSON.parse(workspaceContext(crowded, "chat").split("\n").at(-1));
  assert.equal(payload.notes.length, 6); assert.equal(payload.omittedNotes, 24);
  assert.equal(workspaceContext(emptyWorkspace(), "chat"), "");
});

test("usage limits are bounded, step counting is replay-safe and new turns get a new allowance", () => {
  for (const value of [undefined, null, "", "junk", "31", "0", "2.5", Infinity]) assert.equal(modelStepLimit(value), 12);
  assert.equal(modelStepLimit("3"), 3);
  let result = countModelStep({ turnId: "", steps: [] }, "turn", 0, 2);
  result = countModelStep(result.state, "turn", 0, 2);
  assert.equal(result.state.steps.length, 1);
  result = countModelStep(result.state, "turn", 1, 2); assert.equal(result.cancel, false);
  result = countModelStep(result.state, "turn", 2, 2); assert.equal(result.cancel, true);
  assert.equal(countModelStep(result.state, "next-turn", 10, 2).cancel, false);
  const window = { inputTokens: 250_000, cacheReadTokens: 0, outputTokens: 0 };
  assert.equal(modelUsageWindowReached({ window }), true);
  assert.equal(modelUsageWindowReached({ window: { ...window, cacheReadTokens: 249_999 } }), false);
  assert.equal(modelUsageWindowReached({ window: { ...window, inputTokens: 0, costUsd: 2 } }), true);
  assert.equal(modelUsageWindowReached({ window: { ...window, inputTokens: 0, outputTokens: 30_000 } }), true);
});

test("activity excludes inputs/results/secrets, partial results aren't success and provider cost absence stays unknown", () => {
  const part = { type: "dynamic-tool", toolName: "bash", toolCallId: "a", input: { secret: "DO-NOT-EXPORT" }, output: { status: "completed", exitCode: 0, text: "secret output" }, state: "output-available" };
  const rows = activityRows([{ role: "assistant", parts: [{ ...part, partial: true }, part] }, { role: "user", parts: [part] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].state, "output-available");
  assert.ok(!JSON.stringify(rows).includes("secret"));
  assert.equal(activityRows([{ role: "assistant", parts: [{ ...part, partial: true }] }])[0].state, "running");
  const taskEvents = [{ type: "task.started", data: { callId: "a" } }];
  assert.equal(activityRows([{ role: "assistant", parts: [part] }], taskEvents)[0].state, "running");
  assert.equal(activityRows([{ role: "assistant", parts: [part] }], [...taskEvents, { type: "task.settled", data: { callId: "a", status: "cancelled" } }])[0].state, "cancelled");
  const step = { type: "step.completed", meta: { id: "s" }, data: { turnId: "t", stepIndex: 0, usage: { inputTokens: 42, outputTokens: 7 } } };
  assert.deepEqual(reportedUsage([step, step]), { inputTokens: 42, outputTokens: 7 });
  assert.equal(reportedUsage([step]).costUsd, undefined);
  const checkpoint = { type: "session.waiting", data: { usage: { inputTokens: 100, outputTokens: 30, costUsd: 0.01 } } };
  const next = { ...step, meta: { id: "next" }, data: { ...step.data, turnId: "t2" } };
  assert.deepEqual(reportedUsage([step, checkpoint, next]), { inputTokens: 142, outputTokens: 37 });
  const priced = { ...next, data: { ...next.data, usage: { ...next.data.usage, costUsd: 0.02 } } };
  assert.equal(reportedUsage([checkpoint, priced]).costUsd, 0.03);
  assert.equal(reportedUsage([priced, step]).costUsd, undefined);
  assert.equal(reportedUsage([{ type: "session.waiting", data: { usage: { inputTokens: 100 } } }, priced]).costUsd, undefined);
  assert.equal(reportedUsage([priced, { type: "step.completed", data: { turnId: "t3", stepIndex: 1 } }]).costUsd, undefined);
  assert.equal(reportedUsage([step, checkpoint]).costUsd, 0.01);
  assert.equal(reportedUsage([priced, { type: "session.waiting", data: {} }]).costUsd, undefined);
  assert.equal(reportedUsage([priced, { type: "step.completed" }]).costUsd, undefined);
  assert.equal(reportedUsage([priced, { type: "session.waiting" }]).costUsd, undefined);
  assert.equal(reportedUsage([priced, { type: "session.waiting", data: {} }, checkpoint]).costUsd, 0.01);
  assert.equal(attachedText("https://remote.test/private"), undefined);
  assert.equal(attachedText(`data:text/plain;base64,${Buffer.from("Soomaali — tijaabo").toString("base64")}`), "Soomaali — tijaabo");
});

test("replayed task starts and contradictory late successes cannot undo settled cancellation", () => {
  const part = { type: "dynamic-tool", toolName: "bash", toolCallId: "a", state: "output-available" };
  const messages = [{ role: "assistant", parts: [part] }];
  const start = { type: "task.started", meta: { id: "start" }, data: { callId: "a" } };
  const cancel = { type: "task.settled", meta: { id: "cancel" }, data: { callId: "a", status: "cancelled" } };
  const lateSuccess = { type: "task.settled", meta: { id: "late" }, data: { callId: "a", status: "completed" } };
  assert.equal(activityRows(messages, [start, cancel, start, lateSuccess])[0].state, "cancelled");
  assert.equal(activityRows(messages, [cancel, start])[0].state, "cancelled");
  const timed = { type: "action.result", meta: { at: "2026-10-30T10:00:00.000Z" }, data: { result: { callId: "a" } } };
  assert.equal(activityRows(messages, [timed])[0].at, "2026-10-30T10:00:00.000Z");
  assert.equal(activityRows(messages, [start, { ...cancel, data: { callId: "a", status: "unknown" } }])[0].state, "running");
});

test("turn status uses turn sequence and never infers task completion from a finished turn", async () => {
  const { latestTurnOutcome } = await import("../lib/activity.ts");
  const e = (type, turnId, sequence) => ({ type, data: { turnId, sequence } });
  const cancelled = e("turn.cancelled", "a", 1);
  assert.equal(latestTurnOutcome([e("turn.started", "a", 1), cancelled, e("turn.completed", "a", 1)]), "cancelled");
  assert.equal(latestTurnOutcome([e("turn.started", "b", 2), cancelled]), "active");
  assert.equal(latestTurnOutcome([cancelled, e("turn.completed", "b", 2), cancelled]), "completed");
  assert.equal(latestTurnOutcome([{ type: "task.settled", data: { callId: "a", status: "completed" } }]), undefined);
});

test("bash activity does not equate a failed or background command with success", () => {
  const part = { type: "dynamic-tool", toolName: "bash", toolCallId: "a", state: "output-available" };
  const row = (output) => activityRows([{ role: "assistant", parts: [{ ...part, output }] }])[0].state;
  assert.equal(row({ status: "completed", exitCode: 0 }), "output-available");
  assert.equal(row({ status: "completed", exitCode: 1 }), "output-error");
  assert.equal(row({ status: "running", pid: 123 }), "background-unknown");
  assert.equal(row(undefined), "outcome-unknown");
  const messages = [{ role: "assistant", parts: [{ ...part, output: { status: "completed", exitCode: 0 } }] }];
  const settled = (output) => [{ type: "task.settled", data: { callId: "a", status: "completed", output } }];
  assert.equal(activityRows(messages, settled({ status: "completed", exitCode: 1 }))[0].state, "output-error");
  assert.equal(activityRows(messages, settled({ status: "running" }))[0].state, "background-unknown");
  assert.equal(activityRows(messages, settled(undefined))[0].state, "outcome-unknown");
});
