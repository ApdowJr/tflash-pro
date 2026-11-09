import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";
import { parseAgentMode } from "@/lib/agent-modes";

// The session (and whether accounts are configured at all) is per request;
// prerendering this route would freeze whichever answer the build machine saw.
export const dynamic = "force-dynamic";

/** A clean new-chat surface with the same landing experience as `/`. */
export default async function NewSessionPage({ searchParams }: {
  readonly searchParams: Promise<{ readonly mode?: string | readonly string[] }>;
}) {
  const params = await searchParams;
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  return <AuthenticatedAgentChat initialMode={parseAgentMode(requestedMode)} />;
}
