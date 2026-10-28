import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Capture the real channel's auth function while substituting the transport
// and Supabase request client. Crypto and selection validation remain real.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "eve/channels/eve") return { url: "data:text/javascript,export function eveChannel(options) { return options; }", shortCircuit: true };
    if (specifier === "eve/channels/auth") return { url: "data:text/javascript,export class ForbiddenError extends Error { constructor(options) { super(options.message); } }", shortCircuit: true };
    if (specifier === "@/lib/supabase/request") return { url: "data:text/javascript,export function requestSupabase(request) { return globalThis.__tflashRequestSupabase(request); }", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    if (context.parentURL?.includes("/lib/providers/") && /^\.\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { default: channel } = await import("../agent/channels/eve.ts");
const { CREATE_PROOF_HEADER, signChatCreation, signChatOwnership } = await import("../lib/security/chat-ownership.ts");
const authorize = channel.auth[0];
process.env.NODE_ENV = "production";
process.env.TFLASH_SESSION_SECRET = "test-session-secret-only-0123456789abcdef";
const rows = new Map([["session-a", { user_id: "user-a", owner_proof: signChatOwnership("user-a", "session-a") }]]);

globalThis.__tflashRequestSupabase = (request) => {
  const user = request.headers.get("cookie")?.match(/user=(user-[ab])/)?.[1];
  let sessionId;
  let requestedUser;
  return {
    auth: { getUser: async () => ({ data: { user: user ? { id: user, email: `${user}@example.test`, user_metadata: { full_name: "Test user" } } : null }, error: null }) },
    from: () => ({
      select() { return this; },
      eq(key, value) { if (key === "session_id") sessionId = value; if (key === "user_id") requestedUser = value; return this; },
      async maybeSingle() {
        const row = rows.get(sessionId);
        return { data: row?.user_id === user && requestedUser === user ? row : null, error: null };
      },
    }),
  };
};

function eveRequest(path, method = "GET", user = "user-a", headers = {}) {
  return new Request(`https://app.example.test${path}`, { method, headers: { cookie: `user=${user}`, ...headers } });
}

test("Eve rejects anonymous sessions and requires a short-lived server creation proof", async () => {
  assert.equal(await authorize(new Request("https://app.example.test/eve/v1/session", { method: "POST" })), null);
  await assert.rejects(authorize(eveRequest("/eve/v1/session", "POST")), /Create a conversation/);
  await assert.rejects(authorize(eveRequest("/eve/v1/session", "GET", "user-a", { [CREATE_PROOF_HEADER]: signChatCreation("user-a") })), /Create a conversation/);
  await assert.rejects(authorize(eveRequest("/eve/v1/session", "POST", "user-b", { [CREATE_PROOF_HEADER]: signChatCreation("user-a") })), /Create a conversation/);
  const principal = await authorize(eveRequest("/eve/v1/session", "POST", "user-a", { [CREATE_PROOF_HEADER]: signChatCreation("user-a"), "x-ururka-provider": "openrouter" }));
  assert.equal(principal.principalId, "user-a");
  assert.equal(principal.authenticator, "supabase");
  assert.equal(principal.attributes.email, "user-a@example.test");
  assert.ok(!JSON.stringify(principal.attributes).includes("user=user-a"));
});

test("Eve checks ownership for turns, controls, streams and forged index rows", async () => {
  for (const [path, method] of [
    ["/eve/v1/session/session-a", "POST"],
    ["/eve/v1/session/session-a/stream", "GET"],
    ["/eve/v1/session/session-a/cancel", "POST"],
    ["/eve/v1/session/session-a/reset", "POST"],
    ["/eve/v1/session/session-a/subagent/example/stream", "GET"],
  ]) {
    assert.equal((await authorize(eveRequest(path, method))).principalId, "user-a");
    await assert.rejects(authorize(eveRequest(path, method, "user-b")), /Conversation not available/);
  }
  rows.set("forged", { user_id: "user-b", owner_proof: signChatOwnership("user-a", "session-a") });
  await assert.rejects(authorize(eveRequest("/eve/v1/session/forged/stream", "GET", "user-b")), /Conversation not available/);
  await assert.rejects(authorize(eveRequest("/eve/v1/session/%ZZ/stream")), /Conversation not available/);
});
