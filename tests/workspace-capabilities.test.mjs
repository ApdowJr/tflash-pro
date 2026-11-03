import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { emptyWorkspace, workspaceSchema, assignProject, deleteProject, workspaceContext, workspaceStorageKey } = await import("../lib/workspace.ts");
const { modelStepLimit, countModelStep, modelUsageWindowReached } = await import("../lib/usage-limits.ts");
const { activityRows, reportedUsage } = await import("../lib/activity.ts");
const { attachedText } = await import("../lib/documents/contracts.ts");
const project = (id) => ({ id, name: id, instructions: `Instructions ${id}`, chatIds: [] });
const toolPart = (state, extra = {}) => ({ type: "tool", callId: "a", stepIndex: 0, kind: "tool", name: "bash", label: "Bash", state, ...extra });
const taskStart = (taskId = "task-a", callId = "a") => ({ type: "task.started", data: { taskId, startedBy: { callId }, kind: "tool", name: "bash" } });
const taskEnd = (outcome, taskId = "task-a") => ({ type: "task.ended", data: { taskId, outcome } });
const usage = (value, position) => ({ type: "usage.recorded", ...(position ? { meta: { position } } : {}), data: { kind: "model", usage: value } });
const at = (line, index = 0) => ({ line, index });

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

test("usage limits are bounded, model-run counting is replay-safe and new turns get a new allowance", () => {
  for (const value of [undefined, null, "", "junk", "31", "0", "2.5", Infinity]) assert.equal(modelStepLimit(value), 12);
  assert.equal(modelStepLimit("3"), 3);
  let result = countModelStep({ turnId: "", steps: [] }, "turn", "run-0", 2);
  result = countModelStep(result.state, "turn", "run-0", 2);
  assert.equal(result.state.steps.length, 1);
  result = countModelStep(result.state, "turn", "run-1", 2); assert.equal(result.cancel, false);
  result = countModelStep(result.state, "turn", "run-2", 2); assert.equal(result.cancel, true);
  assert.equal(countModelStep(result.state, "next-turn", "run-3", 2).cancel, false);
  const window = { inputTokens: 250_000, cacheReadTokens: 0, outputTokens: 0 };
  assert.equal(modelUsageWindowReached({ window }), true);
  assert.equal(modelUsageWindowReached({ window: { ...window, cacheReadTokens: 249_999 } }), false);
  assert.equal(modelUsageWindowReached({ window: { ...window, inputTokens: 0, costUsd: 2 } }), true);
  assert.equal(modelUsageWindowReached({ window: { ...window, inputTokens: 0, outputTokens: 30_000 } }), true);
});

test("activity excludes inputs/results/secrets, partial results aren't success and provider cost absence stays unknown", () => {
  const part = toolPart("completed", { input: { secret: "DO-NOT-EXPORT" }, output: { status: "completed", exitCode: 0, text: "secret output" } });
  const rows = activityRows([{ role: "assistant", parts: [part] }, { role: "user", parts: [part] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].state, "output-available");
  assert.ok(!JSON.stringify(rows).includes("secret"));
  assert.equal(activityRows([{ role: "assistant", parts: [toolPart("streaming", { inputText: "private input" })] }])[0].state, "running");
  const taskEvents = [taskStart()];
  assert.equal(activityRows([{ role: "assistant", parts: [part] }], taskEvents)[0].state, "running");
  assert.equal(activityRows([{ role: "assistant", parts: [part] }], [...taskEvents, taskEnd("cancelled")])[0].state, "cancelled");
  assert.equal(attachedText("https://remote.test/private"), undefined);
  assert.equal(attachedText(`data:text/plain;base64,${Buffer.from("Soomaali — tijaabo").toString("base64")}`), "Soomaali — tijaabo");
});

test("replayed task starts and contradictory late successes cannot undo settled cancellation", () => {
  const part = toolPart("completed", { output: { status: "completed", exitCode: 0 } });
  const messages = [{ role: "assistant", parts: [part] }];
  const start = taskStart();
  const cancel = taskEnd("cancelled");
  const lateSuccess = taskEnd("completed");
  assert.equal(activityRows(messages, [start, cancel, start, lateSuccess])[0].state, "cancelled");
  assert.equal(activityRows(messages, [start, cancel, start])[0].state, "cancelled");
  const timed = { type: "call.progress", meta: { at: "2026-10-30T10:00:00.000Z" }, data: { callId: "a" } };
  assert.equal(activityRows(messages, [timed])[0].at, "2026-10-30T10:00:00.000Z");
  assert.equal(activityRows(messages, [start, taskEnd("unknown")])[0].state, "running");
});

test("turn status ranks settlements and never infers task completion from a finished turn", async () => {
  const { latestTurnOutcome } = await import("../lib/activity.ts");
  const e = (type, turnId, extra = {}) => ({ type, data: { turnId, ...extra } });
  assert.equal(latestTurnOutcome([e("turn.started", "a"), e("turn.settled", "a", { outcome: "cancelled" }), e("turn.settled", "a", { outcome: "completed" })]), "cancelled");
  assert.equal(latestTurnOutcome([e("turn.settled", "a", { outcome: "cancelled" }), e("turn.started", "b")]), "active");
  assert.equal(latestTurnOutcome([e("turn.started", "a"), e("turn.settled", "a", { outcome: "cancelled" }), e("turn.settled", "b", { outcome: "completed" }), e("turn.settled", "a", { outcome: "cancelled" })]), "completed");
  assert.equal(latestTurnOutcome([e("delivery.consumed", "c")]), "active");
  assert.equal(latestTurnOutcome([{ type: "task.ended", data: { taskId: "a", outcome: "completed" } }]), undefined);
});

test("bash activity does not equate a failed or background command with success", () => {
  const row = (output) => activityRows([{ role: "assistant", parts: [toolPart("completed", { output })] }])[0].state;
  assert.equal(row({ status: "completed", exitCode: 0 }), "output-available");
  assert.equal(row({ status: "completed", exitCode: 1 }), "output-error");
  assert.equal(row({ status: "running", pid: 123 }), "background-unknown");
  assert.equal(row(undefined), "outcome-unknown");
  const messages = [{ role: "assistant", parts: [toolPart("completed", { output: { status: "completed", exitCode: 0 } })] }];
  const ended = (outcome) => [taskStart(), taskEnd(outcome)];
  assert.equal(activityRows(messages, ended("failed"))[0].state, "output-error");
  assert.equal(activityRows(messages, ended("cancelled"))[0].state, "cancelled");
  assert.equal(activityRows(messages, ended("completed"))[0].state, "outcome-unknown");
  assert.equal(activityRows(messages, ended("unknown"))[0].state, "running");
});

test("reported usage never presents partial token totals as complete and deduplicates replayed facts", () => {
  const complete = usage({ inputTokens: 100, outputTokens: 10, costUsd: 0.1 }, at(0));
  const missingOutput = usage({ inputTokens: 40, costUsd: 0.2 }, at(1));
  assert.deepEqual(reportedUsage([complete, missingOutput]), { inputTokens: 140, costUsd: 0.1 + 0.2 });
  assert.deepEqual(reportedUsage([complete, missingOutput, missingOutput]), { inputTokens: 140, costUsd: 0.1 + 0.2 });
  assert.deepEqual(reportedUsage([complete, { ...complete }]), { inputTokens: 100, outputTokens: 10, costUsd: 0.1 });
  assert.deepEqual(reportedUsage([complete, usage({ inputTokens: 5, outputTokens: 3, costUsd: 0.01 }, at(2))]), { inputTokens: 105, outputTokens: 13, costUsd: 0.1 + 0.01 });
  assert.deepEqual(reportedUsage([complete, usage(undefined, at(2))]), {});
  assert.deepEqual(reportedUsage([complete, usage({}, at(2))]), {});
  assert.deepEqual(reportedUsage([complete, usage({ inputTokens: 5, outputTokens: 3 }, at(2))]), { inputTokens: 105, outputTokens: 13 });
  assert.deepEqual(reportedUsage([missingOutput, usage({ inputTokens: 5, outputTokens: 3, costUsd: 0.01 }, at(2))]), { inputTokens: 45, costUsd: 0.2 + 0.01 });
  assert.deepEqual(reportedUsage([usage({ inputTokens: 1.5, outputTokens: -1, costUsd: 0 }, at(0))]), { costUsd: 0 });
  assert.deepEqual(reportedUsage([usage({ inputTokens: 0, outputTokens: 0, costUsd: 0 }, at(0))]), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
  assert.deepEqual(reportedUsage([{ type: "usage.recorded", data: { kind: "model" } }]), {});
});
