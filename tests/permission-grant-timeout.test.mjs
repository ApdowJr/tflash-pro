import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { hasWebGrant } = await import("../lib/permission-store.ts");
const { webApproval } = await import("../agent/lib/web-approval.ts");

test("real Supabase client aborts stalled grant checks and fails closed after the deadline", async () => {
  let received = 0, firstRequest;
  const started = new Promise((resolve) => { firstRequest = resolve; });
  const server = createServer((request, response) => {
    received++;
    firstRequest();
    request.resume();
    // Deliberately never send headers: no real service, data or credentials.
    response.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.TFLASH_PERMISSIONS_SUPABASE_URL, previousKey = process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY;
  process.env.TFLASH_PERMISSIONS_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = "local-test-only";
  const owner = { kind: "supabase", id: "alice", sessionId: "session-a" };
  try {
    const controller = new AbortController();
    const cancelled = hasWebGrant(owner, "https://example.com/", controller.signal);
    await started;
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(cancelled, { name: "AbortError" });
    const principal = { principalId: "alice", principalType: "user", authenticator: "supabase" };
    const ctx = { session: { id: "session-a", auth: { current: principal, initiator: principal } },
      toolInput: { url: "https://example.com/" }, callId: "call-1", abortSignal: new AbortController().signal };
    const start = Date.now();
    const [timeout, policy] = await Promise.all([
      assert.rejects(hasWebGrant(owner, "https://example.com/"), { name: "TimeoutError" }),
      webApproval(ctx),
    ]);
    assert.equal(timeout, undefined);
    assert.equal(policy, "user-approval");
    assert.ok(Date.now() - start >= 4_500 && Date.now() - start < 15_000);
    assert.equal(received, 3);
  } finally {
    if (previousUrl === undefined) delete process.env.TFLASH_PERMISSIONS_SUPABASE_URL; else process.env.TFLASH_PERMISSIONS_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY; else process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = previousKey;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
