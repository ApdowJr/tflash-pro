import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();

// Exercise the actual authored Eve policies, not a copy of their settings.
process.env.VERCEL_PROJECT_ID = "test-project";
const bash = (await import("../agent/tools/bash.ts")).coderBash;
const webFetch = (await import("../agent/tools/web_fetch.ts")).default;
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
