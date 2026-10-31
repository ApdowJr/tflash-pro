import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__searchPrincipal(); }", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: "data:text/javascript,export async function serverSupabase() { return globalThis.__searchSupabase(); }", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/chats/[sessionId]/search/route.ts");
const { signChatOwnership, OWNER_PROOF_HEADER } = await import("../lib/security/chat-ownership.ts");
process.env.NODE_ENV = "production";
process.env.TFLASH_SESSION_SECRET = "test-session-secret-only-0123456789abcdef";
process.env.TFLASH_INTERNAL_ORIGIN = "https://internal.example.test";
process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "server-only";

let principal = null;
const rows = new Map();
globalThis.__searchPrincipal = () => principal;
globalThis.__searchSupabase = async () => ({
  from() {
    const filter = {};
    return {
      select() { return this; },
      eq(key, value) { filter[key] = value; return this; },
      async maybeSingle() {
        const row = rows.get(filter.session_id);
        return { data: row && row.user_id === principal?.id && row.user_id === filter.user_id ? row : null, error: null };
      },
    };
  },
});
const ctx = (id) => ({ params: Promise.resolve({ sessionId: id }) });
function req(id = "chat-a", query = "needle", headers = {}, signal) {
  return new Request(`https://app.test/api/chats/${id}/search`, { method: "POST", headers: { "content-type": "application/json", cookie: "auth-cookie", ...headers }, body: JSON.stringify({ query }), signal });
}
function eveResponse(events, tail = events.length - 1) {
  return new Response("\n" + events.map((item) => JSON.stringify(item)).join("\n") + "\n", {
    headers: { "x-eve-stream-version": "26", "x-eve-stream-tail-index": String(tail) },
  });
}
const message = (text) => ({ type: "message.received", data: { message: text, parts: [{ type: "text", text }] } });

test("Supabase search checks row ownership and forwards only allowed credentials to the configured Eve origin", async () => {
  rows.clear();
  principal = { id: "alice", kind: "supabase" };
  rows.set("chat-a", { user_id: "alice", owner_proof: signChatOwnership("alice", "chat-a") });
  rows.set("forged", { user_id: "alice", owner_proof: "forged" });
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://internal.example.test/eve/v1/session/chat-a/stream?follow=false&includeTailIndex=1");
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("cookie"), "auth-cookie");
    assert.equal(headers.get("x-vercel-protection-bypass"), "server-only");
    assert.equal(headers.has("x-untrusted"), false);
    assert.equal(headers.has(OWNER_PROOF_HEADER), false);
    return eveResponse([message("A private NEEDLE in a chat")]);
  };
  try {
    const result = await POST(req("chat-a", "needle", { "x-vercel-protection-bypass": "attacker", "x-untrusted": "secret" }), ctx("chat-a"));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { status: "matched", snippet: { before: "A private ", match: "NEEDLE", after: " in a chat" } });
    assert.equal((await POST(req("forged"), ctx("forged"))).status, 404);
    principal = { id: "bob", kind: "supabase" };
    assert.equal((await POST(req(), ctx("chat-a"))).status, 404);
    principal = null;
    assert.equal((await POST(req(), ctx("chat-a"))).status, 404);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("Vercel ownership proofs are bound to account and session, and errors remain partial", async () => {
  principal = { id: "vercel:alice", kind: "vercel" };
  const proof = signChatOwnership(principal.id, "chat-a");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).get(OWNER_PROOF_HEADER), proof);
    return new Response("expired private details", { status: 410 });
  };
  try {
    assert.equal((await POST(req(), ctx("chat-a"))).status, 404);
    assert.equal((await POST(req("chat-b", "needle", { [OWNER_PROOF_HEADER]: proof }), ctx("chat-b"))).status, 404);
    principal = { id: "vercel:bob", kind: "vercel" };
    assert.equal((await POST(req("chat-a", "needle", { [OWNER_PROOF_HEADER]: proof }), ctx("chat-a"))).status, 404);
    principal = { id: "vercel:alice", kind: "vercel" };
    const result = await POST(req("chat-a", "needle", { [OWNER_PROOF_HEADER]: proof }), ctx("chat-a"));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { status: "unavailable" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("search rejects invalid origins, content types, query sizes, and invalid session IDs", async () => {
  principal = { id: "vercel:alice", kind: "vercel" };
  const proof = signChatOwnership(principal.id, "chat-a");
  const head = { [OWNER_PROOF_HEADER]: proof };
  assert.equal((await POST(req("chat-a", "needle", { ...head, origin: "https://evil.test" }), ctx("chat-a"))).status, 403);
  assert.equal((await POST(req("chat-a", "needle", { ...head, "content-type": "text/plain" }), ctx("chat-a"))).status, 415);
  assert.equal((await POST(req("chat-a", "needle", { ...head, "content-type": "application/jsonp" }), ctx("chat-a"))).status, 415);
  assert.equal((await POST(req("chat-a", "a", head), ctx("chat-a"))).status, 400);
  assert.equal((await POST(req("chat-a", " ", head), ctx("chat-a"))).status, 400);
  assert.equal((await POST(req("chat-a", "x".repeat(161), head), ctx("chat-a"))).status, 400);
  assert.equal((await POST(req("chat-a", "x".repeat(3_000), head), ctx("chat-a"))).status, 400);
  assert.equal((await POST(req("invalid", "needle", head), ctx("../invalid"))).status, 404);
});

test("server concurrency is bounded and cancelled requests free their slots", async () => {
  principal = { id: "vercel:alice", kind: "vercel" };
  const proof = signChatOwnership(principal.id, "chat-a");
  const original = globalThis.fetch;
  let calls = 0;
  let ready;
  const allStarted = new Promise((resolve) => { ready = resolve; });
  globalThis.fetch = async () => {
    if (++calls === 8) ready();
    return new Response(new ReadableStream(), { headers: { "x-eve-stream-version": "26", "x-eve-stream-tail-index": "0" } });
  };
  try {
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const pending = controllers.map((controller) => POST(req("chat-a", "needle", { [OWNER_PROOF_HEADER]: proof }, controller.signal), ctx("chat-a")));
    await allStarted;
    const overflow = await POST(req("chat-a", "needle", { [OWNER_PROOF_HEADER]: proof }), ctx("chat-a"));
    assert.equal(overflow.status, 503);
    controllers.forEach((controller) => controller.abort());
    const results = await Promise.all(pending);
    for (const result of results) assert.deepEqual(await result.json(), { status: "unavailable" });
    globalThis.fetch = async () => eveResponse([]);
    assert.deepEqual(await (await POST(req("chat-a", "needle", { [OWNER_PROOF_HEADER]: proof }), ctx("chat-a"))).json(), { status: "no-match" });
  } finally { globalThis.fetch = original; }
});

test("search request body abort is bounded even if its stream reader never cooperates", async () => {
  principal={id:'vercel:alice',kind:'vercel'};
  const proof=signChatOwnership(principal.id,'chat-a');
  const abort=new AbortController(); let cancelled=0;
  const request={url:'https://app.test/api/chats/chat-a/search',signal:abort.signal,
    headers:new Headers({'content-type':'application/json',[OWNER_PROOF_HEADER]:proof}),
    body:{getReader(){return {read(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});},releaseLock(){throw new Error('still locked');}};}}};
  const pending=POST(request,ctx('chat-a'));
  abort.abort();
  assert.equal((await pending).status,400);
  assert.ok(cancelled>=1);
});

test("an aborted upstream fetch that ignores its signal cannot block a search slot", async () => {
  principal={id:'vercel:alice',kind:'vercel'};
  const proof=signChatOwnership(principal.id,'chat-a');
  const original=globalThis.fetch; const abort=new AbortController();
  let resolveFetch, signalStarted; let cancelled=false;
  const started=new Promise(resolve=>{signalStarted=resolve;});
  globalThis.fetch=()=>{signalStarted();return new Promise(resolve=>{resolveFetch=resolve;});};
  try {
    const pending=POST(req('chat-a','needle',{[OWNER_PROOF_HEADER]:proof},abort.signal),ctx('chat-a'));
    await started; abort.abort();
    assert.deepEqual(await (await pending).json(),{status:'unavailable'});
    resolveFetch(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'x-eve-stream-version':'26','x-eve-stream-tail-index':'0'}}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(cancelled,true);
    globalThis.fetch=async()=>eveResponse([]);
    assert.deepEqual(await (await POST(req('chat-a','needle',{[OWNER_PROOF_HEADER]:proof}),ctx('chat-a'))).json(),{status:'no-match'});
  } finally {globalThis.fetch=original;}
});
