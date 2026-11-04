import { sessionAgentMode } from "../lib/session-mode";
import { agentModeInstruction } from "@/lib/agent-modes";
import { defineDynamic, defineInstructions } from "eve/instructions";

/** Bind behavior to the session's first real turn rather than prompt text. */
export default defineDynamic(async (ctx) => {
  const mode = await sessionAgentMode(ctx);
  return defineInstructions({ content: agentModeInstruction(mode), role: "system" });
});
