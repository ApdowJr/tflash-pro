import test from "node:test";
import assert from "node:assert/strict";

// Exercise the actual authored Eve policies, not a copy of their settings.
process.env.VERCEL_PROJECT_ID = "test-project";
const bash = (await import("../agent/tools/bash.ts")).default;
const connections = await Promise.all(
  ["supabase", "vercel", "resend"].map(async (name) => [name, (await import(`../agent/connections/${name}.ts`)).default]),
);

test("shell commands and external management tools require a fresh human approval", async () => {
  for (const [name, definition] of [["bash", bash], ...connections]) {
    assert.equal(typeof definition.approval, "function", `${name} must have an approval policy`);
    // A prior approval must not authorize a later call.
    for (const approvedTools of [[], [name]]) {
      assert.equal(await definition.approval({ approvedTools, toolName: `${name}__action`, toolInput: {} }), "user-approval", name);
    }
  }
});
