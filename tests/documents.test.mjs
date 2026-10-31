import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { register } from "tsx/esm/api";
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
register();
let principal = null;
globalThis.__documentPrincipal = () => principal;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__documentPrincipal(); }", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { exportDocument, extractDocument, boundedBody, MAX_DOCUMENT_BYTES } = await import("../lib/documents/server.ts");
const exportRoute = await import("../app/api/documents/export/route.ts");
const readRoute = await import("../app/api/documents/read/route.ts");
const input = (format, content = "Warbixin Soomaali — tijaabo\nSample size: 42.\n<script>inert</script>") => ({ format, filename: "report.md", content });

test("real PDF and DOCX exports round-trip their Unicode text through isolated parsers", async () => {
  for (const format of ["pdf", "docx"]) {
    const bytes = await exportDocument(input(format));
    assert.equal(Buffer.from(bytes.subarray(0, format === "pdf" ? 5 : 2)).toString("ascii"), format === "pdf" ? "%PDF-" : "PK");
    const result = await extractDocument(bytes, format);
    assert.match(result.text, /Warbixin Soomaali — tijaabo/);
    assert.match(result.text, /Sample size: 42/);
    assert.ok(result.text.includes("<script>inert</script>"));
    assert.equal(result.truncated, false);
  }
  await assert.rejects(exportDocument(input("pdf", "Unsupported emoji 🚀")), /cannot represent/);
  await assert.rejects(exportDocument({ ...input("pdf"), filename: "../unsafe.md" }));
  await assert.rejects(exportDocument(input("pdf", "x".repeat(50001))));
});

test("document parser rejects wrong bytes, oversized/empty files, scanned PDFs, missing XML and unsafe DOCTYPE", async () => {
  for (const [bytes, format] of [[Buffer.from("not a pdf"), "pdf"], [new Uint8Array(MAX_DOCUMENT_BYTES + 1), "pdf"], [new Uint8Array(), "docx"], [zipSync({ "other.xml": strToU8("missing part") }), "docx"]]) await assert.rejects(extractDocument(bytes, format));
  const pdf = await PDFDocument.create(); pdf.addPage();
  await assert.rejects(extractDocument(await pdf.save(), "pdf"), /could not be read/);
  const malicious = zipSync({ "word/document.xml": strToU8('<!DOCTYPE x [<!ENTITY e "secret">]><w:document xmlns:w="w"><w:p><w:t>&e;</w:t></w:p></w:document>') });
  await assert.rejects(extractDocument(malicious, "docx"), /could not be read/);
  const bomb = zipSync({ "word/document.xml": strToU8("x".repeat(1024 * 1024 + 1)) });
  await assert.rejects(extractDocument(bomb, "docx"), /could not be read/);
  const pages = await PDFDocument.create(); for (let n = 0; n < 51; n++) { const p = pages.addPage(); p.drawText(`Page ${n + 1}`); }
  const result = await extractDocument(await pages.save(), "pdf");
  assert.equal(result.truncated, true); assert.equal(result.pages, 51);
  assert.ok(!result.text.includes("--- Page 51 ---"));
});

test("document routes enforce login for both operations, reject cross-site/invalid bodies and return genuine no-store downloads", async () => {
  const exportRequest = (body, headers = {}) => new Request("https://app.test/api/documents/export", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await exportRoute.POST(exportRequest(input("pdf")))).status, 401);
  assert.equal((await readRoute.POST(new Request("https://app.test/api/documents/read", { method: "POST" }))).status, 401);
  for (const kind of ["supabase", "vercel"]) {
    principal = { id: `user-${kind}`, kind };
    assert.equal((await exportRoute.POST(exportRequest(input("pdf"), { origin: "https://evil.test" }))).status, 403);
    assert.equal((await exportRoute.POST(exportRequest({ ...input("pdf"), filename: "x.exe" }))).status, 422);
    const response = await exportRoute.POST(exportRequest(input("pdf")));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-disposition"), /report.pdf/);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    const read = await readRoute.POST(new Request("https://app.test/api/documents/read", { method: "POST", headers: { "content-type": "application/pdf" }, body: await response.arrayBuffer() }));
    assert.equal(read.status, 200); assert.match((await read.json()).text, /Sample size: 42/);
  }
  const request = new Request("https://app.test/upload", { method: "POST", body: new Uint8Array(101) });
  await assert.rejects(boundedBody(request, 100), /too large/);
});

test("document routes bind the expected account before reading a body", async () => {
  principal = { id: 'alice', kind: 'vercel' };
  for (const [route, contentType] of [[readRoute, 'application/pdf'], [exportRoute, 'application/json']]) {
    let pulled = false;
    const body = new ReadableStream({ pull() { pulled = true; return new Promise(() => {}); } });
    const request = new Request('https://app.test/doc', { method:'POST', headers:{ 'content-type':contentType, 'x-tflash-expected-user-id':'bob', 'x-tflash-expected-account-kind':'vercel' }, body, duplex:'half' });
    const result = await route.POST(request);
    assert.equal(result.status, 409);
    // A stream implementation may pre-pull, but the route must not lock/read it.
    assert.equal(request.body.locked, false);
  }
});

test("server document body read times out and cancels a stalled or oversized stream", async () => {
  const timeout = AbortSignal.timeout; const deadlines = [];
  AbortSignal.timeout = () => { const c = new AbortController(); deadlines.push(c); return c.signal; };
  try {
    let cancelled = false;
    const request = new Request('https://app.test/upload', { method:'POST', duplex:'half', body:new ReadableStream({ pull(){return new Promise(()=>{});}, cancel(){cancelled=true; return new Promise(()=>{});} }) });
    const pending = boundedBody(request, 100);
    deadlines[0].abort();
    await assert.rejects(pending); assert.equal(cancelled, true);
    let oversizeCancelled = false;
    const large = new Request('https://app.test/upload', { method:'POST', duplex:'half', body:new ReadableStream({ start(controller){controller.enqueue(new Uint8Array(101));}, cancel(){oversizeCancelled=true;return new Promise(()=>{});} }) });
    await assert.rejects(boundedBody(large, 100), /too large/); assert.equal(oversizeCancelled, true);
  } finally { AbortSignal.timeout = timeout; }
});

test("export response reader enforces type, byte limit and bounded stalled body", async () => {
  const { readDocumentBlob } = await import('../lib/documents/client-fetch.ts');
  const controller = new AbortController();
  await assert.rejects(readDocumentBlob(new Response('bad', {headers:{'content-type':'evil/application/pdf'}}), controller.signal, 'application/pdf'), /type/);
  await assert.rejects(readDocumentBlob(new Response('x', {headers:{'content-type':'application/pdf','content-length':String(17*1024*1024)}}), controller.signal, 'application/pdf'), /large/);
  let cancelled=false;
  const result=readDocumentBlob(new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'content-type':'application/pdf'}}),controller.signal,'application/pdf');
  controller.abort(); await assert.rejects(result); assert.equal(cancelled,true);
});
