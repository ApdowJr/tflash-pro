import { defineTool } from "eve/tools";
import { artifactInputSchema, artifactOutputSchema } from "@/lib/agent-workspace";

export default defineTool({
  description: "Create a downloadable text deliverable in this conversation: a Markdown report, plain text, CSV, or valid JSON. Supply the full finished content and a simple filename. This does not run code, upload to external storage, or create PDFs. Never include credentials. Users choose whether to preview or download it.",
  inputSchema: artifactInputSchema,
  outputSchema: artifactOutputSchema,
  label: { start: ({ filename }) => filename },
  execute(input) {
    return { kind: "tflash-artifact" as const, version: 1 as const, artifact: artifactInputSchema.parse(input) };
  },
  toModelOutput(output) {
    return { type: "text" as const, value: `Created downloadable ${output.artifact.filename} (${output.artifact.content.length} characters). It is available in this conversation; no external upload was performed.` };
  },
});
