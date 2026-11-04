import { agentModeFromAuth, type AgentMode } from "@/lib/agent-modes";
import type { DynamicContext } from "eve/tools";

/**
 * Bind on the first real model turn, not when an idle launch session is
 * prepared. Each dynamic definition has its own memo namespace; the shared
 * key and request metadata make them resolve the same session mode.
 */
export function sessionAgentMode(ctx: DynamicContext): Promise<AgentMode> {
  return ctx.memo("tflash:operating-mode:v1", () => agentModeFromAuth(
    undefined,
    ctx.session.auth.current?.attributes,
  ));
}
