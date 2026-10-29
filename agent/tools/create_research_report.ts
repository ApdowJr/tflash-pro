import { defineTool } from "eve/tools";
import { artifactInputSchema } from "@/lib/agent-workspace";
import { researchMarkdown, researchReportInputSchema, researchReportOutputSchema } from "@/lib/research";
import { readSourceReceipt } from "@/lib/research-evidence";

export default defineTool({
  description: "Create a downloadable Markdown research report in English or Somali. Supply the exact opaque receipts returned by successful web_fetch calls in this authenticated chat (valid seven days). Each finding must cite one or more 1-based receipt indexes. Search snippets or invented URLs are not fetched evidence: read pages first. The report separates AI synthesis from fetched excerpts and requires explicit limitations. Receipts attest retrieval, not factual correctness or claim support.",
  inputSchema: researchReportInputSchema,
  outputSchema: researchReportOutputSchema,
  availableInSubagents: false,
  async execute(input, ctx) {
    const report = researchReportInputSchema.parse(input);
    const sources = await Promise.all(report.receipts.map((receipt) => readSourceReceipt(receipt, ctx)));
    if (new Set(sources.map((source) => source.url)).size !== sources.length) throw new Error("Use each requested source URL only once.");
    const artifact = artifactInputSchema.parse({
      filename: report.filename,
      description: report.language === "so" ? "Warbixin AI soo koobtay oo leh ilaha la akhriyey; dib u eeg sheegashooyinka." : "AI-written research with fetched sources; review the claims.",
      content: researchMarkdown(report, sources),
    });
    return { kind: "tflash-research-report" as const, version: 1 as const, artifact, sources };
  },
  toModelOutput(output) {
    return { type: "text" as const, value: `Created ${output.artifact.filename} with ${output.sources.length} fetched sources. The downloadable report is attached to this tool result. Retrieval does not independently verify claims.` };
  },
});
