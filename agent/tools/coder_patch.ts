import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { apply_patch } from "eve/extensions/code/tools";

const patch = defineTool({
  ...apply_patch,
  approval: always(),
  availableInSubagents: false,
  label: { start: ({ root }) => `Patch ${root ?? "workspace"}` },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? patch : null);
