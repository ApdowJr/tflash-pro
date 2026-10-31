import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { register } from "tsx/esm/api";
register();
// Keep the REAL fetch and Undici dispatcher. Substitute only OS DNS results;
// every tested destination must fail before any connection is attempted.
let addresses = [];
let dnsCalls = 0;
globalThis.__securityLookup = (_host, _options, callback) => {
  dnsCalls++;
  callback(null, addresses);
};
const dnsModule = new URL("./fixtures/private-dns.cjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:dns" && context.parentURL !== dnsModule)
      return { url: dnsModule, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const tool = (await import("../agent/tools/web_fetch.ts")).default;
const ctx = {
  approval: { responder: { principalId: "test-user" } },
  session: {
    id: "dns-test",
    auth: { current: { principalType: "user", principalId: "test-user" } },
  },
};

test("the patched Undici dispatcher rejects private and mixed DNS answers before connection", async () => {
  for (const answer of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "::1", family: 6 }],
    [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  ]) {
    addresses = answer;
    await assert.rejects(
      tool.execute(
        { url: "https://github.com/" },
        { ...ctx, abortSignal: AbortSignal.timeout(3000) },
      ),
      (error) => {
        const chain = [];
        for (let current = error; current; current = current.cause)
          chain.push(current.message);
        assert.match(chain.join(" "), /private|link-local|reserved/i);
        return true;
      },
    );
  }
  assert.ok(dnsCalls >= 4);
});
