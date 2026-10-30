import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();

const { INTEGRATIONS } = await import("../lib/integrations/catalog.ts");
const { defineIntegrationConnection } = await import("../lib/integrations/connection.ts");
const bash = (await import("../agent/tools/bash.ts")).default;

test("every registered MCP integration requires approval despite reusable-looking hints", async () => {
  for (const integration of INTEGRATIONS) {
    // Exercise each actual Eve registration, not a copy of its policy.
    const connection = (await import(`../agent/connections/${integration.id}.ts`)).default;
    assert.equal(connection.url, defineIntegrationConnection(integration.id).url);
    assert.equal(connection.toolCall?.providedArguments, undefined);
    for (const toolName of ["read_data", "delete_all"]) {
      const ctx = { toolName, toolInput: { resource: "any" }, callId: "call", approvedTools: new Set([toolName]),
        toolAnnotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false } };
      assert.equal(await connection.approval(ctx), "user-approval", `${integration.id}:${toolName}`);
    }
  }
});

test("shell requires per-call approval even for familiar or previously approved commands", async () => {
  for (const command of ["pwd", "rm -rf /", "cat /etc/passwd"]) {
    assert.equal(await bash.approval({ toolName: "bash", toolInput: { command }, callId: "call", approvedTools: new Set(["bash"]) }), "user-approval");
  }
});
