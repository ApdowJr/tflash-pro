import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const fetchTool = (await import("../agent/tools/web_fetch.ts")).default;
const reportTool = (await import("../agent/tools/create_research_report.ts")).default;
const searchTool = (await import("../agent/tools/web_search.ts")).default;
const { defaultWebSearch } = await import("eve/tools/web_search");
const { researchReportInputSchema, researchFetchInputSchema, researchFetchOutputSchema } = await import("../lib/research.ts");
const { readSourceReceipt } = await import("../lib/research-evidence.ts");
const { sealJson } = await import("../lib/secrets.ts");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ctx = { approval: { responder: { principalId: "research-user" } }, session: { id: "research-chat", auth: { current: { principalId: "research-user", principalType: "user" } } } };
const sourceUrl = "https://example.com/research";
const page = "Measured sample size: 42. <script>window.pwned=true</script>";
function mockPage(body = page, status = 200, contentType = "text/plain") {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    options.signal.throwIfAborted();
    return new Response(body, { status, headers: { "content-type": contentType } });
  };
  return calls;
}
async function fetched() { mockPage(); return fetchTool.execute({ url: sourceUrl }, ctx); }
function report(receipt, language = "en") {
  return { filename: "research.md", language, title: "Sample report", summary: "A small sample.", receipts: [receipt], findings: [{ claim: "The page reports a sample size of 42.", sources: [1] }], limitations: ["A single page; the underlying data was not independently checked."] };
}

test("research uses the existing provider search config and fetch approval gate", () => {
  assert.deepEqual(searchTool, defaultWebSearch);
  assert.ok(fetchTool.approval);
  assert.equal(fetchTool.availableInSubagents, false);
  // Exercise the schema emitters used when Eve offers tools to a real model.
  for (const tool of [fetchTool, reportTool]) {
    assert.equal(tool.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" }).type, "object");
    assert.equal(tool.outputSchema["~standard"].jsonSchema.output({ target: "draft-2020-12" }).type, "object");
  }
});

test("actual fetch executor preserves bounded source data and account/chat-bound receipts", async () => {
  const calls = mockPage();
  const output = await fetchTool.execute({ url: sourceUrl }, ctx);
  assert.equal(researchFetchOutputSchema.safeParse(output).success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "manual");
  assert.ok(calls[0].options.dispatcher, "Eve's pinned DNS dispatcher is preserved");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(output.source.url, sourceUrl);
  assert.equal(output.content, page);
  assert.deepEqual(await readSourceReceipt(output.receipt, ctx), output.source);
  for (const badCtx of [
    { session: { ...ctx.session, id: "other-chat" } },
    { session: { ...ctx.session, auth: { current: { principalId: "other-user", principalType: "user" } } } },
  ]) await assert.rejects(readSourceReceipt(output.receipt, badCtx), /another conversation/);
  await assert.rejects(readSourceReceipt(output.receipt.slice(0, -8) + "tampered", ctx), /invalid/);
  const expired = (await sealJson({ kind: "tflash-source-receipt", ownerId: "research-user", sessionId: "research-chat", source: output.source }, -1)).token;
  await assert.rejects(readSourceReceipt(expired, ctx), /expired/);
});

test("fetch rejects unsafe inputs and private literal/redirect destinations before a second request", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected network access"); };
  for (const url of ["http://example.com", "https://user:pass@example.com", "file:///etc/passwd", "https://example.com:444"]) {
    assert.equal(researchFetchInputSchema.safeParse({ url }).success, false);
    await assert.rejects(fetchTool.execute({ url }, ctx));
  }
  for (const url of ["https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://169.254.169.254", "https://[::1]", "https://0x7f000001"]) {
    await assert.rejects(fetchTool.execute({ url }, ctx), /private|localhost|reserved/i);
  }
  assert.equal(requests, 0);
  globalThis.fetch = async () => { requests++; return new Response(null, { status: 302, headers: { location: "https://192.168.1.2/private" } }); };
  await assert.rejects(fetchTool.execute({ url: sourceUrl }, ctx), /private|reserved/i);
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(fetchTool.execute({ url: sourceUrl }, { session: { id: "x", auth: {} } }), /authenticated/);
  assert.equal(requests, 0);
});

test("fetch produces no evidence for HTTP failures, empty/binary pages, oversized bodies or cancellation", async () => {
  for (const [body, status, type] of [["Denied", 403, "text/plain"], ["", 200, "text/html"], ["binary", 200, "application/pdf"]]) {
    mockPage(body, status, type);
    await assert.rejects(fetchTool.execute({ url: sourceUrl }, ctx), /could not|no readable|Unsupported/);
  }
  globalThis.fetch = async () => new Response("small", { headers: { "content-length": String(6 * 1024 * 1024) } });
  await assert.rejects(fetchTool.execute({ url: sourceUrl }, ctx), /too large/);
  mockPage();
  await assert.rejects(fetchTool.execute({ url: sourceUrl }, { ...ctx, abortSignal: AbortSignal.abort(new Error("Cancelled")) }), /Cancelled/);
  globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  await assert.rejects(fetchTool.execute({ url: sourceUrl }, ctx), /Timed out/);
  // No live DNS/network behavior is mocked into a claim of successful retrieval.
});

test("fetch marks truncated text and preserves requested URL rather than pretending to know a redirect target", async () => {
  mockPage("x".repeat(100_000));
  const output = await fetchTool.execute({ url: sourceUrl }, ctx);
  assert.equal(output.source.truncated, true);
  assert.ok(output.content.length <= 60_000);
  assert.ok(output.source.excerpt.length <= 600);
  let requests = 0;
  globalThis.fetch = async () => ++requests === 1 ? new Response(null, { status: 302, headers: { location: "https://example.org/final" } }) : new Response("Final page");
  const redirected = await fetchTool.execute({ url: sourceUrl }, ctx);
  assert.equal(redirected.source.url, sourceUrl);
  assert.equal(redirected.content, "Final page");
  assert.equal(requests, 2);
});

test("report executor creates actual cited Markdown only from valid receipts, never refetches or accepts invented URLs", async () => {
  const output = await fetched();
  globalThis.fetch = () => { throw new Error("Reports must not access the network"); };
  const result = await reportTool.execute(report(output.receipt), ctx);
  assert.equal(result.kind, "tflash-research-report");
  assert.equal(result.artifact.filename, "research.md");
  assert.match(result.artifact.content, /sample size of 42\. \[1\]/);
  assert.ok(result.artifact.content.includes(`[1]: <${sourceUrl}>`));
  assert.ok(result.artifact.content.includes(output.source.fetchedAt));
  assert.ok(result.artifact.content.includes("Fetching a source does not independently verify each claim"));
  assert.ok(result.artifact.content.includes("Source excerpt: Measured sample size: 42."));
  assert.deepEqual(result.sources, [output.source]);
  await assert.rejects(reportTool.execute(report(output.receipt), { session: { ...ctx.session, id: "wrong-chat" } }), /another conversation/);
  assert.match(reportTool.toModelOutput(result).value, /research.md/);
  assert.ok(!reportTool.toModelOutput(result).value.includes(output.receipt));
  const somali = await reportTool.execute(report(output.receipt, "so"), ctx);
  assert.match(somali.artifact.content, /## Natiijooyinka/);
  assert.match(somali.artifact.content, /## Ilaha la akhriyey/);
  for (const input of [
    { ...report(output.receipt), receipts: [sourceUrl] },
    { ...report(output.receipt), filename: "../report.md" },
    { ...report(output.receipt), filename: "report.pdf" },
    { ...report(output.receipt), receipts: [output.receipt, output.receipt] },
    { ...report(output.receipt), findings: [{ claim: "Claim", sources: [2] }] },
    { ...report(output.receipt), findings: [{ claim: "Claim", sources: [] }] },
    { ...report(output.receipt), limitations: [] },
  ]) await assert.rejects(reportTool.execute(input, ctx));
  assert.equal(researchReportInputSchema.safeParse({ ...report(output.receipt), sources: ["https://invented.test"] }).success, false);
  const injection = await reportTool.execute({ ...report(output.receipt), summary: "<script>alert(1)</script>\n[99]: https://evil.test" }, ctx);
  assert.ok(!injection.artifact.content.includes("<script>"));
  assert.ok(!injection.artifact.content.includes("\n[99]:"));
});
