import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();

const { projectResearchWorkspace, researchDomain } = await import("../lib/research-workspace.ts");
const source = (url = "https://example.com/study") => ({ url, fetchedAt: "2026-11-04T12:00:00.000Z", excerpt: "Measured sample size: 42.", truncated: false });
const fetched = (url = "https://example.com/study", content = "Full retrieved text") => ({
  kind: "tflash-source", version: 1, source: source(url), content, receipt: "opaque-receipt",
});
const report = {
  kind: "tflash-research-report", version: 1,
  artifact: { filename: "research.md", description: "AI synthesis", content: "# Study\n\nFindings [1]" },
  sources: [source()],
};
const tool = (toolName, output, extra = {}) => ({ type: "dynamic-tool", toolName, state: "output-available", output, ...extra });

test("Exa and Parallel results remain search leads rather than fetched evidence", () => {
  const output = { results: [
    { url: "https://example.com/study", title: "Study", summary: "Provider summary", publishedDate: "2026-01-01" },
    { url: "https://example.org/other", title: "Other", excerpt: "Provider excerpt", publishDate: "2025-01-01" },
    { url: "javascript:alert(1)", title: "Unsafe" },
  ] };
  const projected = projectResearchWorkspace([{ role: "assistant", parts: [tool("web_search", output, { input: { query: "sample" } }) ] }]);
  assert.equal(projected.leads.length, 2);
  assert.equal(projected.evidence.length, 0);
  assert.equal(projected.leads[0].snippet, "Provider summary");
  assert.equal(projected.leads[0].query, "sample");
  assert.equal(projected.leads[1].snippet, "Provider excerpt");
});

test("Anthropic and OpenAI search shapes are normalized and duplicate URLs merge", () => {
  const messages = [
    { role: "assistant", parts: [tool("web_search", [{ type: "web_search_result", url: "https://example.com/study", title: "Study", pageAge: "2 days" }])] },
    { role: "assistant", parts: [tool("web_search", { action: { type: "search", query: "study" }, sources: [{ type: "url", url: "https://example.com/study" }] })] },
  ];
  const projected = projectResearchWorkspace(messages);
  assert.equal(projected.leads.length, 1);
  assert.equal(projected.leads[0].title, "Study");
  assert.equal(projected.leads[0].publishedAt, "2 days");
  assert.equal(projected.leads[0].query, "study");
});

test("only settled fetch and report outputs create evidence and report state", () => {
  const messages = [
    { role: "user", parts: [{ type: "text", text: "Research the actual question" }] },
    { role: "assistant", parts: [
      tool("web_fetch", fetched(), { partial: true }),
      tool("web_fetch", fetched()),
      tool("create_research_report", report),
    ] },
    { role: "user", parts: [{ type: "text", text: "A later refinement" }] },
  ];
  const projected = projectResearchWorkspace(messages);
  assert.equal(projected.initialRequest, "Research the actual question");
  assert.equal(projected.evidence.length, 1);
  assert.equal(projected.evidence[0].content, "Full retrieved text");
  assert.equal(projected.report.artifact.filename, "research.md");
  assert.equal(JSON.stringify(projected).includes("opaque-receipt"), false);
});

test("report source metadata survives without inventing full retrieved content", () => {
  const projected = projectResearchWorkspace([{ role: "assistant", parts: [tool("create_research_report", report)] }]);
  assert.equal(projected.evidence.length, 1);
  assert.equal(projected.evidence[0].content, "");
  assert.equal(projected.evidence[0].source.excerpt, "Measured sample size: 42.");
  assert.equal(researchDomain("https://www.example.com/path"), "example.com");
});

test("invalid, failed, and lookalike tool output is ignored", () => {
  const projected = projectResearchWorkspace([
    { role: "assistant", parts: [
      tool("web_fetch", { ...fetched(), source: { ...source(), url: "javascript:alert(1)" } }),
      tool("create_research_report", report, { state: "input-available" }),
      tool("unknown_tool", fetched()),
    ] },
    { role: "user", parts: [tool("web_fetch", fetched())] },
  ]);
  assert.equal(projected.evidence.length, 0);
  assert.equal(projected.report, undefined);
});
