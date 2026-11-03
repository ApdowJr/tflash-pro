import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { MAX_SEARCH_EVENTS, MAX_SEARCH_LINE_CHARS, MAX_SEARCH_STREAM_BYTES, searchEveStream } = await import("../lib/chat-search-stream.ts");

const encode = (value) => new TextEncoder().encode(value);
const fact = (type, data = {}, scope) => ({ type, data, ...(scope ? { scope } : {}) });
const commit = (...facts) => ({ at: "2026-10-31T00:00:00.000Z", facts });
const progress = (item) => ({ progress: item });
const consumed = (text, { turnId = "t", parts, history } = {}) => commit(fact("delivery.consumed", {
  deliveryId: "d", turnId, parts: parts ?? [{ kind: "text", text }], ...(history ? { history } : {}),
}));
const reply = (value, { partId = "p", runId = "r", kind = "text", phase = "reply", extra } = {}) =>
  commit(fact("content.completed", { partId, runId, kind, phase, value, ...extra }));
const delta = (text, { partId = "p", runId = "r", turnId = "t", kind } = {}) =>
  progress(fact("content.delta", { partId, delta: text, ...(kind ? { kind } : {}) }, { runId, turnId }));
const modelRequested = (runId = "r", turnId = "t") => commit(fact("model.requested", { runId, owner: { turnId } }));
const modelSettled = (runId = "r") => commit(fact("model.settled", { runId, outcome: "completed" }));
const turnSettled = (turnId = "t", outcome = "completed") => commit(fact("turn.settled", { turnId, outcome }));
const headers = (tail, version = "27") => ({ "x-eve-stream-tail-index": String(tail), "x-eve-stream-version": version });
const stored = (records) => records.filter((record) => !("$eve" in record)).length;
function stream(records, { tail, version = "27", chunk = 7 } = {}) {
  const bytes = encode("\n" + records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  }), { headers: headers(tail ?? stored(records) - 1, version) });
}
const search = (response, query = "needle", signal = new AbortController().signal) => searchEveStream(response, query, signal);

test("user, imported and assistant text matches Unicode/case without interpreting query as a regex", async () => {
  const result = await search(stream([
    consumed(null, { parts: [], history: [{ role: "assistant", text: "Hore" }, { role: "user", text: "Qorshe: SOOMAALI waa qurux" }] }),
  ]), "soomaali");
  assert.deepEqual(result, { status: "matched", snippet: { before: "Qorshe: ", match: "SOOMAALI", after: " waa qurux" } });
  assert.equal((await search(stream([consumed("A cafe\u0301 note")]), "CAFÉ")).status, "matched");
  assert.equal((await search(stream([reply("Find the literal .* syntax")]), ".*")).status, "matched");
  assert.equal((await search(stream([reply("everything else")]), ".*")).status, "no-match");
});

test("matches rendered text only: exclude tool, reasoning, results and file metadata; retain messages before context clearing", async () => {
  const events = [
    consumed(null, {
      parts: [{ kind: "text", text: "Hello" }, { kind: "file", filename: "needle.pdf", mediaType: "application/pdf" }],
    }),
    reply("needle", { kind: "reasoning" }),
    reply("needle", { kind: "result", partId: "result" }),
    commit(fact("context.settled", { outcome: "completed", selects: null })),
    reply("Other visible text", { partId: "other" }),
  ];
  assert.equal((await search(stream(events))).status, "no-match");
  assert.equal((await search(stream([consumed("Needle before reset")]), "needle")).status, "matched");
  assert.equal((await search(stream([consumed(null, { parts: [{ kind: "text", text: "hello" }, { kind: "file", filename: "needle.pdf", mediaType: "application/pdf" }] })]))).status, "no-match");
  assert.equal((await search(stream([consumed(null, { parts: [{ kind: "file", filename: "needle.pdf", mediaType: "application/pdf" }] })]))).status, "no-match");
  assert.equal((await search(stream([reply("different", { partId: "other" }), reply("Needle in a later reply", { partId: "later" })]))).status, "matched");
});

test("streaming text is joined across deltas, but a completion or model settlement replaces the tentative run", async () => {
  const split = [delta("look for nee", { kind: "text" }), delta("dle here"), turnSettled("t", "cancelled")];
  const splitResult = await search(stream(split));
  assert.equal(splitResult.status, "matched");
  assert.equal(splitResult.snippet.match, "needle");
  assert.equal((await search(stream([delta("needle", { kind: "text" }), reply("revised answer")]))).status, "no-match");
  assert.equal((await search(stream([delta("needle", { kind: "text" }), modelSettled()]))).status, "no-match");
  assert.equal((await search(stream([reply("revised answer", { partId: "other" }), reply("needle", { partId: "later" })]))).status, "matched");
  assert.equal((await search(stream([delta("needle", { kind: "text" })]))).status, "matched"); // Visible at the pinned tail.
  assert.equal((await search(stream([delta("needle", { kind: "text" })], { tail: 1 }))).status, "unavailable"); // Could still be replaced.
});

test("transport records are not stored lines and do not advance the tail position", async () => {
  const records = [{ $eve: "heartbeat" }, consumed("needle"), { $eve: "heartbeat" }];
  assert.equal((await search(stream(records, { tail: 0 }))).status, "matched");
  const windowed = [{ $eve: "position", next: 5 }, consumed("needle")];
  assert.equal((await search(stream(windowed, { tail: 5 }))).status, "matched");
  const truncatedWindow = [{ $eve: "position", next: 5 }, consumed("nothing")];
  assert.equal((await search(stream(truncatedWindow, { tail: 6 }))).status, "unavailable");
});

test("short, malformed and unsupported streams never claim a definitive no-match", async () => {
  assert.equal((await search(stream([]))).status, "no-match");
  assert.equal((await search(stream([consumed("nothing")], { tail: 1 }))).status, "unavailable");
  assert.equal((await search(stream([consumed("nothing")], { version: "26" }))).status, "unavailable");
  assert.equal((await search(stream([consumed("nothing")], { version: "28" }))).status, "unavailable");
  assert.equal((await search(stream([consumed("needle")]))).status, "matched");
  assert.equal((await search(new Response("{}\n", { headers: { "x-eve-stream-version": "27" } }))).status, "unavailable");
  assert.equal((await search(new Response("not json\n", { headers: headers(0) }))).status, "unavailable");
  assert.equal((await search(stream([{ at: "2026-10-31T00:00:00.000Z", facts: [] }]))).status, "unavailable");
  assert.equal((await search(stream([progress(fact("content.delta", { partId: "p", delta: 17 }))]))).status, "unavailable");
  assert.equal((await search(stream([consumed(null, { parts: [{ kind: "text", text: 17 }] })]))).status, "unavailable");
  assert.equal((await search(stream([consumed(null, { parts: [] })], { tail: 0 }))).status, "no-match");
  assert.equal((await search(new Response(null, { status: 410 }))).status, "unavailable");
  // A trustworthy earlier match remains useful even if a later line would be unavailable.
  assert.equal((await search(stream([consumed("needle")], { tail: 500 }))).status, "matched");
});

test("limits and cancellation report partial results and release the reader", async () => {
  const oversizedLine = new Response("x".repeat(MAX_SEARCH_LINE_CHARS + 1), { headers: headers(0) });
  assert.equal((await search(oversizedLine)).status, "unavailable");
  const oversizedStream = new Response(encode(" ".repeat(MAX_SEARCH_STREAM_BYTES + 1)), { headers: headers(0) });
  assert.equal((await search(oversizedStream)).status, "unavailable");
  const manyFacts = Array.from({ length: MAX_SEARCH_EVENTS }, () => commit(fact("turn.started", { turnId: "t" })));
  assert.equal((await search(stream(manyFacts, { tail: MAX_SEARCH_EVENTS, chunk: MAX_SEARCH_STREAM_BYTES }))).status, "unavailable");

  let cancelled = false;
  const aborter = new AbortController();
  const slow = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: headers(0) });
  const pending = search(slow, "needle", aborter.signal);
  aborter.abort();
  assert.equal((await pending).status, "unavailable");
  assert.equal(cancelled, true);
});

test("a withheld completion keeps a negative result partial", async () => {
  assert.equal((await search(stream([reply(undefined, { extra: { valueRef: { withheld: true } } })]))).status, "unavailable");
  assert.equal((await search(stream([reply(undefined, { extra: { valueRef: { ref: "v1" } } })]))).status, "unavailable");
  assert.equal((await search(stream([reply(undefined, { extra: { valueRef: { preview: "needle" } } })]))).status, "unavailable");
});

test("aborted search stops waiting even when a stream reader ignores cancellation", async () => {
  let cancelled = 0, released = 0;
  const signal = new AbortController();
  const response = { ok: true, headers: new Headers(headers(0)), body: { getReader() { return {
    read() { return new Promise(() => {}); }, cancel() { cancelled++; return new Promise(() => {}); }, releaseLock() { released++; throw new Error("still locked"); },
  }; } } };
  const pending = searchEveStream(response, "needle", signal.signal);
  signal.abort();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.ok(cancelled >= 1); assert.equal(released, 1);
});
