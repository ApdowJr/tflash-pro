import { writeWorkspaceFile } from "../lib/coder-workspace";
import { sessionAgentMode } from "../lib/session-mode";
import { coderWorkspaceWriteInputSchema, coderWorkspaceWriteSchema } from "@/lib/coder-workspace";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";

const write = defineTool({
  description: "Apply one complete editor draft to a Coder sandbox text file. Requires approval and an expectedSha256 from coder_workspace_read; null is only for creating a file that does not exist. The write is rejected when the file changed after loading, then verified by reading it back. Use coder_patch for targeted agent-authored edits instead of rewriting whole files.",
  inputSchema: coderWorkspaceWriteInputSchema,
  outputSchema: coderWorkspaceWriteSchema,
  availableInSubagents: false,
  approval: always(),
  label: { start: ({ path }) => `Apply editor draft to ${path}` },
  async execute(input, ctx) {
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(20_000)]);
    const sandbox = await ctx.getSandbox();
    return writeWorkspaceFile(sandbox, input, signal);
  },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? write : null);
