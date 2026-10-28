import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";

// The session (and whether accounts are configured at all) is per request;
// prerendering this route would freeze whichever answer the build machine saw.
export const dynamic = "force-dynamic";

/** A clean new-chat surface with the same landing experience as `/`. */
export default function NewSessionPage() {
  return <AuthenticatedAgentChat />;
}
