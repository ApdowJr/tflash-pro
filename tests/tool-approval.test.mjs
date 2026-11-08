import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();

// Exercise the actual authored Eve policies, not a copy of their settings.
process.env.VERCEL_PROJECT_ID = "test-project";
const bash = (await import("../agent/tools/bash.ts")).coderBash;
const webFetch = (await import("../agent/tools/web_fetch.ts")).default;
const { coderPatch } = await import("../agent/tools/coder_patch.ts");
const agentDefinition = (await import("../agent/agent.ts")).default;
const delegationTool = (await import("../agent/tools/agent.ts")).default;
const connections = await Promise.all(
  ["github", "linear", "neon", "notion", "posthog", "resend", "sentry", "stripe", "supabase", "vercel"].map(async (name) => [name, (await import(`../agent/connections/${name}.ts`)).default]),
);

test("shell commands and external management tools require a fresh human approval", async () => {
  for (const [name, definition] of [["bash", bash], ["web_fetch", webFetch], ...connections]) {
    assert.equal(typeof definition.approval, "function", `${name} must have an approval policy`);
    // A prior approval must not authorize a later call.
    for (const approvedTools of [[], [name]]) {
      assert.equal(await definition.approval({ approvedTools, toolName: `${name}__action`, toolInput: {}, abortSignal: new AbortController().signal }), "user-approval", name);
    }
  }
});


test("dangerous and concurrent shell calls still require independent approval", async () => {
  const calls = ["rm -rf /workspace", "cat ~/.ssh/id_rsa", "git push --force", "echo safe" ];
  const decisions = await Promise.all(calls.map((command, index) => bash.approval({
    toolName: "bash", toolInput: { command }, callId: `call-${index}`, approvedTools: ["bash"],
  })));
  assert.deepEqual(decisions, calls.map(() => "user-approval"));
});

test("default framework tools are opt-in and delegation remains explicitly available", () => {
  assert.equal(agentDefinition.defaultTools, false);
  assert.ok(delegationTool, "root-copy delegation must survive defaultTools:false");
});

test("coder_patch is Coder-only, always approved, and uses the rc.6 edit contract", async () => {
  const tool = coderPatch;
  assert.equal(tool.availableInSubagents, false);
  assert.equal(await tool.approval({ approvedTools: ["coder_patch"], toolName: "coder_patch", toolInput: {}, abortSignal: new AbortController().signal }), "user-approval");
  const schema = tool.inputSchema;
  const validate = schema["~standard"].validate;
  const parsed = await validate({ path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] });
  assert.equal(parsed.issues, undefined);
  const legacy = await validate({ patch: "*** Begin Patch" });
  assert.ok(legacy.issues?.length);
});
