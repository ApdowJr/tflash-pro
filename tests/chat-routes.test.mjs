import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Exercise the actual Next route handlers with a small RLS-like index and a
// fake Eve transport. These tests never contact Supabase or an AI provider.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__tflashMockPrincipal(); }", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") {
      return { url: "data:text/javascript,export async function serverSupabase() { return globalThis.__tflashMockSupabase(); }", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL?.includes("/lib/providers/") && /^\.\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { GET, POST } = await import("../app/api/chats/route.ts");
const chatRoute = await import("../app/api/chats/[sessionId]/route.ts");
const { CREATE_PROOF_HEADER, OWNER_PROOF_HEADER, signChatOwnership, verifyChatCreation } = await import("../lib/security/chat-ownership.ts");

process.env.NODE_ENV = "production";
process.env.TFLASH_SESSION_SECRET = "test-session-secret-only-0123456789abcdef";
process.env.TFLASH_INTERNAL_ORIGIN = "https://eve.example.test";
process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "server-only-test-bypass";

let currentUser = null;
let currentKind = "supabase";
let selectError = null;
let insertError = null;
const originalGlobalFetch = globalThis.fetch;
globalThis.__tflashMockPrincipal = () => currentUser ? { id: currentUser, kind: currentKind, name: "Test", email: "test@example.test" } : null;
const rows = new Map();

class Query {
  constructor(user) { this.user = user; this.filters = []; this.action = "select"; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  not(key, operator, value) { assert.equal(operator, "is"); this.filters.push((row) => row[key] !== value); return this; }
  is(key, value) { this.filters.push((row) => row[key] === value); return this; }
  order() { return this; }
  limit() { return this; }
  update(patch) { this.action = "update"; this.patch = patch; return this; }
  delete() { this.action = "delete"; return this; }
  async insert(row) {
    if (insertError) return { data: null, error: insertError };
    if (row.user_id !== this.user || rows.has(row.session_id)) return { error: { message: "RLS or duplicate" } };
    rows.set(row.session_id, { ...row, updated_at: new Date().toISOString() });
    return { error: null };
  }
  async execute(single = false) {
    if (this.action === "select" && selectError) return { data: null, error: selectError };
    const matches = [...rows.values()].filter((row) => row.user_id === this.user && this.filters.every((filter) => filter(row)));
    if (this.action === "update") matches.forEach((row) => Object.assign(row, this.patch));
    if (this.action === "delete") matches.forEach((row) => rows.delete(row.session_id));
    return { data: single ? matches[0] ?? null : matches, error: null };
  }
  maybeSingle() { return this.execute(true); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

globalThis.__tflashMockSupabase = async () => {
  if (globalThis.__realSupabase) return globalThis.__realSupabase;
  const user = currentUser;
  return { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) }, from: () => new Query(user) };
};

function jsonRequest(url, method, headers = {}, body = {}) {
  return new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const detail = (id) => ({ params: Promise.resolve({ sessionId: id }) });

afterEach(() => {
  currentUser = null; currentKind = "supabase"; selectError = null; insertError = null;
  rows.clear(); delete globalThis.__realSupabase; globalThis.fetch = originalGlobalFetch;
});

test("chat routes reject unauthenticated callers and non-JSON mutations", async () => {
  currentUser = null;
  assert.equal((await GET()).status, 401);
  assert.equal((await POST(jsonRequest("https://app.test/api/chats", "POST"))).status, 401);
  assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/x", "PATCH", {}, { title: "x" }), detail("x"))).status, 404);
  assert.equal((await POST(new Request("https://app.test/api/chats", { method: "POST" }))).status, 415);
});

test("creation, history, isolation, forgery checks, and best-effort deletion", async () => {
  rows.clear();
  currentUser = "user-a";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const headers = new Headers(options.headers);
    assert.equal(headers.get("cookie"), "test-session-cookie");
    assert.equal(headers.get("x-vercel-protection-bypass"), "server-only-test-bypass");
    assert.equal(options.redirect, "error");
    if (String(url).endsWith("/eve/v1/session")) {
      assert.ok(verifyChatCreation("user-a", headers.get(CREATE_PROOF_HEADER)));
      assert.equal(headers.get("x-tflash-provider"), "openrouter");
      assert.equal(headers.has("x-untrusted-header"), false);
      return Response.json({ sessionId: "session-a" });
    }
    assert.equal(String(url), "https://eve.example.test/eve/v1/session/session-a/reset");
    // Revocation must continue even if Eve cannot reset an active workflow.
    throw new Error("simulated Eve outage");
  };
  try {
    const created = await POST(jsonRequest("https://app.test/api/chats", "POST", {
      cookie: "test-session-cookie", "x-tflash-provider": "openrouter", "x-untrusted-header": "do-not-forward",
      "x-vercel-protection-bypass": "client-bypass",
    }));
    assert.equal(created.status, 201);
    assert.equal((await created.json()).sessionId, "session-a");
    assert.equal(rows.get("session-a").owner_proof, signChatOwnership("user-a", "session-a"));
    assert.deepEqual((await (await GET()).json()).chats, []); // Drafts are hidden.

    const patch = await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "  First chat  ", activity: true }), detail("session-a"));
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).title, "First chat");
    assert.equal((await (await GET()).json()).chats[0].title, "First chat");

    const renamed = await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "  Project notes  " }), detail("session-a"));
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).title, "Project notes");
    // A later message, including one from a stale browser, must not undo a rename.
    const activity = await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "First chat", activity: true }), detail("session-a"));
    assert.equal(activity.status, 200);
    assert.equal((await activity.json()).title, "Project notes");
    assert.equal((await (await GET()).json()).chats[0].title, "Project notes");
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "  " }), detail("session-a"))).status, 400);
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, null), detail("session-a"))).status, 400);
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "x", activity: "true" }), detail("session-a"))).status, 400);

    currentUser = "user-b";
    rows.set("forged", { session_id: "forged", user_id: "user-b", title: "forged", owner_proof: "not-a-signature", updated_at: new Date().toISOString() });
    assert.deepEqual((await (await GET()).json()).chats, []);
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/session-a", "PATCH", {}, { title: "stolen" }), detail("session-a"))).status, 404);
    assert.equal((await chatRoute.DELETE(jsonRequest("https://app.test/api/chats/session-a", "DELETE"), detail("session-a"))).status, 404);
    assert.equal((await chatRoute.DELETE(jsonRequest("https://app.test/api/chats/forged", "DELETE"), detail("forged"))).status, 404);
    assert.equal(calls.length, 1);

    currentUser = "user-a";
    const deleted = await chatRoute.DELETE(jsonRequest("https://app.test/api/chats/session-a", "DELETE", { cookie: "test-session-cookie" }), detail("session-a"));
    assert.equal(deleted.status, 200);
    assert.equal(rows.has("session-a"), false);
    assert.equal((await chatRoute.DELETE(jsonRequest("https://app.test/api/chats/session-a", "DELETE"), detail("session-a"))).status, 404);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid Eve session responses do not create index entries", async () => {
  rows.clear();
  currentUser = "user-a";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ sessionId: "../not-a-session" });
  try {
    const result = await POST(jsonRequest("https://app.test/api/chats", "POST"));
    assert.equal(result.status, 502);
    assert.equal(rows.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Vercel chat proofs are issued to the authenticated owner and cannot cross accounts", async () => {
  currentKind = "vercel";
  currentUser = "vercel:alice";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const headers = new Headers(options.headers);
    calls.push({ url: String(url), headers });
    if (String(url).endsWith("/eve/v1/session")) {
      assert.equal(verifyChatCreation("vercel:alice", headers.get(CREATE_PROOF_HEADER)), true);
      return Response.json({ sessionId: "vercel-session" });
    }
    assert.equal(headers.get(OWNER_PROOF_HEADER), signChatOwnership("vercel:alice", "vercel-session"));
    return Response.json({ ok: true });
  };
  try {
    const response = await POST(jsonRequest("https://app.test/api/chats", "POST", { cookie: "better-auth-test" }));
    assert.equal(response.status, 201);
    const { sessionId, ownerProof } = await response.json();
    assert.equal(sessionId, "vercel-session");
    assert.equal(ownerProof, signChatOwnership("vercel:alice", sessionId));
    assert.equal((await (await GET()).json()).storage, "browser");
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/vercel-session", "PATCH", {}, { title: "x" }), detail(sessionId))).status, 404);
    currentUser = "vercel:bob";
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/vercel-session", "PATCH", { [OWNER_PROOF_HEADER]: ownerProof }, { title: "x" }), detail(sessionId))).status, 404);
    currentUser = "vercel:alice";
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/vercel-session", "PATCH", { [OWNER_PROOF_HEADER]: ownerProof }, { title: "x" }), detail(sessionId))).status, 200);
    assert.equal((await chatRoute.PATCH(jsonRequest("https://app.test/api/chats/vercel-session", "PATCH", { [OWNER_PROOF_HEADER]: ownerProof }, { title: "x", activity: true }), detail(sessionId))).status, 200);
    assert.equal((await chatRoute.DELETE(jsonRequest("https://app.test/api/chats/vercel-session", "DELETE", { cookie: "better-auth-test", [OWNER_PROOF_HEADER]: ownerProof }), detail(sessionId))).status, 200);
    assert.equal(calls.length, 2);
  } finally {
    currentKind = "supabase";
    globalThis.fetch = originalFetch;
  }
});


test("missing chat storage is reported before creating an Eve workflow, without leaking database details", async () => {
  currentUser = "user-a";
  selectError = { code: "PGRST205", message: "private schema diagnostic" };
  let eveCalls = 0;
  globalThis.fetch = async () => { eveCalls++; return Response.json({ sessionId: "unused" }); };
  const response = await POST(jsonRequest("https://app.test/api/chats", "POST"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    code: "CHAT_STORAGE_SETUP_REQUIRED", error: "Chat storage is not configured for this deployment.",
  });
  assert.equal(eveCalls, 0, "do not create an orphan when storage is already unavailable");
  assert.equal(rows.size, 0);
});

test("the real PostgREST client reports a missing table from a zero-row GET preflight", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  currentUser = "user-a";
  let eveCalls = 0;
  globalThis.fetch = async () => { eveCalls++; return Response.json({ sessionId: "unused" }); };
  const preflights = [];
  globalThis.__realSupabase = createClient("https://supabase.example.test", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      preflights.push({ url: String(url), method: options.method });
      return Response.json({ code: "PGRST205", message: "could not find the table" }, { status: 404 });
    } },
  });
  const response = await POST(jsonRequest("https://app.test/api/chats", "POST"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "CHAT_STORAGE_SETUP_REQUIRED");
  assert.equal(preflights.length, 1);
  assert.equal(preflights[0].method, "GET");
  assert.equal(new URL(preflights[0].url).searchParams.get("limit"), "0");
  assert.equal(eveCalls, 0);
});

test("RLS/insert failures do not fall back to browser ownership or leak server diagnostics", async () => {
  currentUser = "user-a";
  insertError = { code: "42501", message: "private policy diagnostic" };
  let eveCalls = 0;
  globalThis.fetch = async () => { eveCalls++; return Response.json({ sessionId: "session-a" }); };
  const response = await POST(jsonRequest("https://app.test/api/chats", "POST"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "CHAT_STORAGE_UNAVAILABLE", error: "Could not save the conversation. Please try again.",
  });
  assert.equal(eveCalls, 1, "an insert can still fail after a successful preflight");
  assert.equal(rows.size, 0);
});

test("Vercel identities do not query Supabase during session preparation", async () => {
  currentUser = "vercel-user"; currentKind = "vercel";
  selectError = { code: "PGRST205", message: "not applicable" };
  globalThis.fetch = async () => Response.json({ sessionId: "vercel-session" });
  const response = await POST(jsonRequest("https://app.test/api/chats", "POST"));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.ok(body.sessionId);
  assert.ok(body.ownerProof);
  assert.equal(rows.size, 0);
});
