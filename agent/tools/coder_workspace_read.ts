import { readWorkspaceFile } from "../lib/coder-workspace";
import { sessionAgentMode } from "../lib/session-mode";
import { coderWorkspaceReadInputSchema, coderWorkspaceReadSchema } from "@/lib/coder-workspace";
import { defineDynamic, defineTool } from "eve/tools";

const read = defineTool({
  description: "Read one text file from the Coder sandbox for the workspace editor. Return its full-content SHA-256 and a bounded text view. Secret environment files, binary files, Git internals, and paths outside the workspace are rejected. Use the returned hash for any later coder_workspace_write.",
  inputSchema: coderWorkspaceReadInputSchema,
  outputSchema: coderWorkspaceReadSchema,
  availableInSubagents: false,
  label: { start: ({ path }) => `Open ${path}` },
  async execute({ path }, ctx) {
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(15_000)]);
    const sandbox = await ctx.getSandbox();
    const file = await readWorkspaceFile(sandbox, path, signal);
    if (!file) throw new Error("The requested file does not exist.");
    return file;
  },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? read : null);
