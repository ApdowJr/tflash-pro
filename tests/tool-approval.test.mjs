import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  if (context.parentURL?.includes("/lib/integrations/") && /^\.\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
}});

// Exercise the actual authored Eve policies, not a copy of their settings.
process.env.VERCEL_PROJECT_ID = "test-project";
const bash = (await import("../agent/tools/bash.ts")).default;
const connections = await Promise.all(
  ["github", "linear", "neon", "notion", "posthog", "resend", "sentry", "stripe", "supabase", "vercel"].map(async (name) => [name, (await import(`../agent/connections/${name}.ts`)).default]),
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
