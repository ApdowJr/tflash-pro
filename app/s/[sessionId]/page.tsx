import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";

// The session (and whether accounts are configured at all) is per request;
// prerendering this route would freeze whichever answer the build machine saw.
export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AuthenticatedAgentChat sessionId={sessionId} />;
}
