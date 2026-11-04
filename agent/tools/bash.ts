import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { bash } from "eve/tools/bash";

export const coderBash = defineTool({
  ...bash,
  description: `${bash.description} Available only in Coder conversations. Commands run in this conversation's sandbox and require approval; a command receipt is not proof of test success until its exit code and output are observed.`,
  approval: always(),
});

// Shell commands can have network and filesystem side effects, even in a sandbox.
export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? coderBash : null);
