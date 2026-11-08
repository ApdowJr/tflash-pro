import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { editFile } from "eve/tools/edit_file";

// Keep the established coder_patch tool name for the workspace projection and
// historical sessions, but use Eve rc.6's supported exact-replacement editor.
export const coderPatch = defineTool({
  ...editFile,
  description: "Apply targeted, non-overlapping text replacements to one Coder sandbox file. Requires approval. Each oldText must match a unique region of the original file; a failed edit changes nothing. Inspect the result and run relevant checks before claiming success.",
  approval: always(),
  availableInSubagents: false,
  label: { start: ({ path }) => `Edit ${path}` },
});

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? coderPatch : null);
