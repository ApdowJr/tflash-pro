import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();

const { planInputSchema, artifactInputSchema, latestAgentPlan, artifactMediaType } = await import("../lib/agent-workspace.ts");
const planTool = (await import("../agent/tools/update_plan.ts")).default;
const artifactTool = (await import("../agent/tools/create_artifact.ts")).default;
const plan = { title: "Prepare report", steps: [
  { id: "research", title: "Check sources", status: "in_progress" },
  { id: "report", title: "Write report", status: "pending" },
] };

test("the authored plan tool validates full snapshots without executing their steps", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Plan metadata must not access the network"); };
  try {
    const output = await planTool.execute(plan, {});
    assert.equal(output.kind, "tflash-plan");
    assert.deepEqual(output.plan, plan);
    assert.equal(planTool.availableInSubagents, false);
    assert.equal(planInputSchema.safeParse({ ...plan, steps: [...plan.steps, plan.steps[0]] }).success, false);
    assert.equal(planInputSchema.safeParse({ ...plan, steps: plan.steps.map((step) => ({ ...step, status: "in_progress" })) }).success, false);
    for (const steps of [[], Array.from({ length: 13 }, (_, i) => ({ id: String(i), title: "Step", status: "pending" }))]) {
      assert.equal(planInputSchema.safeParse({ title: "Plan", steps }).success, false);
    }
    assert.equal(planInputSchema.safeParse({ title: "Plan", steps: [{ id: "one", title: "Step", status: "blocked", detail: "Approval denied" }] }).success, true);
  } finally { globalThis.fetch = original; }
});

test("the progress panel uses only settled assistant plan-tool output, including after resume", () => {
  const part = (value = plan, state = "output-available", toolName = "update_plan") => ({
    type: "dynamic-tool", toolName, state, output: { kind: "tflash-plan", version: 1, plan: value },
  });
  const first = { role: "assistant", parts: [part()] };
  const updated = { ...plan, steps: plan.steps.map((step) => ({ ...step, status: "completed" })) };
  assert.deepEqual(latestAgentPlan(JSON.parse(JSON.stringify([first]))), plan);
  assert.deepEqual(latestAgentPlan([first, { role: "assistant", parts: [part(updated)] }]), updated);
  for (const ignored of [
    { role: "user", parts: [part(updated)] },
    { role: "assistant", parts: [part(updated, "output-error")] },
    { role: "assistant", parts: [part(updated, "input-available")] },
    { role: "assistant", parts: [part(updated, "output-available", "some_other_tool")] },
    { role: "assistant", parts: [part({ title: "Invalid", steps: [] })] },
  ]) assert.deepEqual(latestAgentPlan([first, ignored]), plan);
  assert.equal(latestAgentPlan([]), undefined);
});

test("text artifact generation returns real bounded content with a compact model summary", async () => {
  const artifact = { filename: "report.md", description: "Report", content: "# Report\nVerified facts." };
  const output = await artifactTool.execute(artifact, {});
  assert.deepEqual(output, { kind: "tflash-artifact", version: 1, artifact });
  assert.match(artifactTool.toModelOutput(output).value, /report.md/);
  assert.ok(!artifactTool.toModelOutput(output).value.includes("Verified facts"));
  for (const filename of ["../secret.txt", "/etc/report.txt", "file\\report.txt", "report.html", "report.pdf", "report.exe", "report\n.txt", "file\u202e.txt"]) {
    assert.equal(artifactInputSchema.safeParse({ ...artifact, filename }).success, false, filename);
  }
  assert.equal(artifactInputSchema.safeParse({ ...artifact, content: "x".repeat(100001) }).success, false);
  assert.equal(artifactInputSchema.safeParse({ ...artifact, content: "" }).success, false);
  assert.equal(artifactInputSchema.safeParse({ ...artifact, filename: "data.json", content: "not json" }).success, false);
  assert.equal(artifactInputSchema.safeParse({ ...artifact, filename: "data.json", content: '{"ok":true}' }).success, true);
  assert.equal(artifactMediaType("report.md"), "text/markdown;charset=utf-8");
  assert.equal(artifactMediaType("data.json"), "application/json;charset=utf-8");
});

test("provisional plan snapshots never replace a settled plan", () => {
  const settled = { role: "assistant", parts: [{ type: "dynamic-tool", toolName: "update_plan", state: "output-available", output: { kind: "tflash-plan", version: 1, plan } }] };
  const provisional = { ...settled.parts[0], partial: true, output: { kind: "tflash-plan", version: 1, plan: { ...plan, title: "Provisional" } } };
  assert.deepEqual(latestAgentPlan([settled, { role: "assistant", parts: [provisional] }]), plan);
  assert.equal(latestAgentPlan([{ role: "assistant", parts: [provisional] }]), undefined);
});
