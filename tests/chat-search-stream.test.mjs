import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return next(specifier, context);
} });
const { MAX_SEARCH_EVENTS, MAX_SEARCH_LINE_CHARS, MAX_SEARCH_STREAM_BYTES, searchEveStream } = await import("../lib/chat-search-stream.ts");

const encode = (value) => new TextEncoder().encode(value);
const event = (type, data = {}) => ({ type, data });
const received = (text) => event("message.received", { turnId: "t", message: text, parts: [{ type: "text", text }] });
const complete = (text, turnId = "t", stepIndex = 0) => event("message.completed", { turnId, stepIndex, message: text });
const appended = (text, turnId = "t", stepIndex = 0) => event("message.appended", { turnId, stepIndex, messageDelta: text });
const v1Event = (type, data, scope, line) => ({ type, data, ...(scope ? { scope } : {}), meta: { position: { line, index: 0 }, at: "2026-11-01T00:00:00.000Z" } });
const v1Start = (line = 0) => v1Event("turn.started", { turnId: "t", cause: { deliveryId: "d" }, follows: null }, { turnId: "t" }, line);
const v1Consumed = (text, line = 1) => v1Event("delivery.consumed", { deliveryId: "d", turnId: "t", parts: [{ kind: "text", text }] }, { turnId: "t" }, line);
const v1Reply = (text, line = 2, phase = "reply") => v1Event("content.completed", { partId: `p${line}`, runId: `r${line}`, kind: "text", value: text, phase }, { turnId: "t", runId: `r${line}` }, line);
const v1Settle = (line = 3) => v1Event("turn.settled", { turnId: "t", outcome: "completed" }, { turnId: "t" }, line);
const headers = (tail, version = "26") => ({ "x-eve-stream-tail-index": String(tail), "x-eve-stream-version": version });
function stream(events, { tail = events.length - 1, version = "26", chunk = 7 } = {}) {
  const bytes = encode("\n" + events.map((item) => JSON.stringify(item)).join("\n") + (events.length ? "\n" : ""));
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  }), { headers: headers(tail, version) });
}
const search = (response, query = "needle", signal = new AbortController().signal) => searchEveStream(response, query, signal);

test("user, imported and assistant text matches Unicode/case without interpreting query as a regex", async () => {
  const result = await search(stream([
    event("history.imported", { messages: [{ role: "assistant", text: "Hore" }, { role: "user", text: "Qorshe: SOOMAALI waa qurux" }] }),
  ]), "soomaali");
  assert.deepEqual(result, { status: "matched", snippet: { before: "Qorshe: ", match: "SOOMAALI", after: " waa qurux" } });
  assert.equal((await search(stream([received("A cafe\u0301 note")]), "CAFÉ")).status, "matched");
  assert.equal((await search(stream([complete("Find the literal .* syntax")]), ".*")).status, "matched");
  assert.equal((await search(stream([complete("everything else")]), ".*")).status, "no-match");
});

test("matches rendered text only: exclude tool, reasoning and file metadata; retain messages before context clearing", async () => {
  const events = [
    event("message.received", { message: "text [file: needle.pdf]", parts: [{ type: "text", text: "Hello" }, { type: "file", filename: "needle.pdf", mediaType: "application/pdf" }] }),
    event("reasoning.completed", { reasoning: "needle" }),
    event("action.result", { result: { output: "needle" } }),
    event("result.completed", { result: "needle" }),
    event("context.cleared"),
    complete("Other visible text"),
  ];
  assert.equal((await search(stream(events))).status, "no-match");
  assert.equal((await search(stream([received("Needle before reset"), event("context.cleared")]))).status, "matched");
  assert.equal((await search(stream([event("message.received", { message: "hello [file: needle.pdf (application/pdf)]" })]))).status, "unavailable");
  assert.equal((await search(stream([event("message.received", { message: "hello [file: secret.pdf (application/pdf)]" })]), "hello")).status, "unavailable");
  assert.equal((await search(stream([event("message.received", { message: "hello [file: name]needle.pdf (application/pdf)]" })]))).status, "unavailable");
  assert.equal((await search(stream([event("message.received", { message: "[file: secret.pdf (application/pdf)]" }), complete("needle")]))).status, "matched");
});

test("streaming text is joined across deltas, but completed text replaces the tentative run", async () => {
  const split = [appended("look for nee"), appended("dle here"), event("turn.cancelled", { turnId: "t" })];
  const splitResult = await search(stream(split));
  assert.equal(splitResult.status, "matched");
  assert.equal(splitResult.snippet.match, "needle");
  assert.equal((await search(stream([appended("needle"), complete("revised answer")]))).status, "no-match");
  assert.equal((await search(stream([appended("needle"), event("step.completed", { turnId: "t", stepIndex: 0 }), complete("revised answer")]))).status, "matched");
  assert.equal((await search(stream([appended("needle")]))).status, "matched"); // Visible at the pinned tail.
  assert.equal((await search(stream([appended("needle")], { tail: 1 }))).status, "unavailable"); // Could still be replaced.
});

test("short, malformed and unsupported streams never claim a definitive no-match", async () => {
  assert.equal((await search(stream([]))).status, "no-match");
  assert.equal((await search(stream([received("nothing")], { tail: 1 }))).status, "unavailable");
  assert.equal((await search(stream([v1Start(), v1Settle(1)], { version: "27" }))).status, "no-match");
  assert.equal((await search(stream([event("message.appended", { turnId: "t", stepIndex: 0, messageDelta: "needle", messageSoFar: "needle" })], { version: "24" }))).status, "matched");
  assert.equal((await search(stream([appended("needle")], { version: "24" }))).status, "unavailable");
  assert.equal((await search(stream([event("message.appended", { turnId: "t", stepIndex: 0, messageDelta: "nothing", messageSoFar: "invalid" })], { version: "26" }))).status, "unavailable");
  assert.equal((await search(stream([event("reasoning.appended", { reasoningDelta: "nothing", reasoningOffset: 0 })]))).status, "unavailable");
  assert.equal((await search(new Response("{}\n", { headers: { "x-eve-stream-version": "26" } }))).status, "unavailable");
  assert.equal((await search(new Response("not json\n", { headers: headers(0) }))).status, "unavailable");
  assert.equal((await search(stream([event("message.received", { parts: [{ type: "text", text: 17 }] })]))).status, "unavailable");
  assert.equal((await search(new Response(null, { status: 410 }))).status, "unavailable");
  // A trustworthy earlier match remains useful even if a later event would be unavailable.
  assert.equal((await search(stream([received("needle")], { tail: 500 }))).status, "matched");
});

test("limits and cancellation report partial results and release the reader", async () => {
  const oversizedLine = new Response("x".repeat(MAX_SEARCH_LINE_CHARS + 1), { headers: headers(0) });
  assert.equal((await search(oversizedLine)).status, "unavailable");
  const oversizedStream = new Response(encode(" ".repeat(MAX_SEARCH_STREAM_BYTES + 1)), { headers: headers(0) });
  assert.equal((await search(oversizedStream)).status, "unavailable");
  const events = Array.from({ length: MAX_SEARCH_EVENTS }, () => event("step.started"));
  assert.equal((await search(stream(events, { tail: MAX_SEARCH_EVENTS, chunk: MAX_SEARCH_STREAM_BYTES }))).status, "unavailable");

  let cancelled = false;
  const aborter = new AbortController();
  const slow = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: headers(0) });
  const pending = search(slow, "needle", aborter.signal);
  aborter.abort();
  assert.equal((await pending).status, "unavailable");
  assert.equal(cancelled, true);
});


test("protocol v1 search follows Eve's durable transcript and excludes narration and unfinished text", async () => {
  const userMatch = await search(stream([v1Start(), v1Consumed("Qorshe: SOOMAALI waa qurux"), v1Settle(2)], { version: "27" }), "soomaali");
  assert.deepEqual(userMatch, { status: "matched", snippet: { before: "Qorshe: ", match: "SOOMAALI", after: " waa qurux" } });

  const assistantMatch = await search(stream([v1Start(), v1Reply("A completed needle reply"), v1Settle(2)], { version: "27" }));
  assert.equal(assistantMatch.status, "matched");
  assert.equal((await search(stream([v1Start(), v1Reply("needle in narration", 1, "narration"), v1Settle(2)], { version: "27" }))).status, "no-match");
  assert.equal((await search(stream([v1Start(), v1Event("content.delta", { partId: "p", kind: "text", delta: "needle" }, { turnId: "t", runId: "r" }, 1)], { version: "27" }))).status, "unavailable");
});

test("aborted search stops waiting even when a stream reader ignores cancellation", async () => {
  let cancelled=0, released=0;
  const signal=new AbortController();
  const response={ok:true,headers:new Headers(headers(0)),body:{getReader(){return {
    read(){return new Promise(()=>{});}, cancel(){cancelled++;return new Promise(()=>{});}, releaseLock(){released++;throw new Error('still locked');},
  };}}};
  const pending=searchEveStream(response,'needle',signal.signal);
  signal.abort();
  assert.deepEqual(await pending,{status:'unavailable'});
  assert.ok(cancelled>=1); assert.equal(released,1);
});
