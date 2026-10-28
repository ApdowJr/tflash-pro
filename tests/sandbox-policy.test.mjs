import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Capture the options passed to Eve's environment without starting a VM.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "eve/sandbox") {
      return {
        url: "data:text/javascript,export const DefaultSandbox = { environment: () => ({ open: async options => options }) }; export function defineSandbox(selector) { return selector; }",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { default: openSandbox } = await import("../agent/sandbox.ts");

test("production shell sandboxes deny network egress; local just-bash remains usable", async () => {
  const previous = process.env.EVE_DEV;
  try {
    delete process.env.EVE_DEV;
    assert.equal((await openSandbox()).networkPolicy, "deny-all");
    process.env.EVE_DEV = "0";
    assert.equal((await openSandbox()).networkPolicy, "deny-all");
    process.env.EVE_DEV = "1";
    assert.equal((await openSandbox()).networkPolicy, "allow-all");
  } finally {
    if (previous === undefined) delete process.env.EVE_DEV;
    else process.env.EVE_DEV = previous;
  }
});
