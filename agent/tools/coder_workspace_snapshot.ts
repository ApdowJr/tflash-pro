import { snapshotWorkspace } from "../lib/coder-workspace";
import { sessionAgentMode } from "../lib/session-mode";
import { coderWorkspaceSnapshotInputSchema, coderWorkspaceSnapshotSchema } from "@/lib/coder-workspace";
import { defineDynamic, defineTool } from "eve/tools";

const snapshot = defineTool({
  description: "Observe the current Coder sandbox for the workspace UI. Return a bounded file list, Git branch/status, and real diff. This is a point-in-time local observation, not proof of remote synchronization or test success. Use after entering a workspace and after changes when the user needs an updated file tree or diff.",
  inputSchema: coderWorkspaceSnapshotInputSchema,
  outputSchema: coderWorkspaceSnapshotSchema,
  availableInSubagents: false,
  label: { start: () => "Inspect workspace" },
  async execute(_input, ctx) {
    const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(25_000)]);
    const sandbox = await ctx.getSandbox();
    return snapshotWorkspace(sandbox, signal);
  },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? snapshot : null);
