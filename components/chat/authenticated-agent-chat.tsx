import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SignIn } from "@/components/auth/sign-in";
import { AgentChat } from "./agent-chat";

/**
 * Server entry point for the chat surface: resolves the Better Auth session
 * once, then hands the account to the client shell so the sidebar can show it.
 */
export async function AuthenticatedAgentChat({
  sessionId,
  sessionless,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  if (process.env.NODE_ENV === "development") {
    return <AgentChat sessionId={sessionId} sessionless={sessionless} />;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <SignIn />;

  return (
    <AgentChat
      account={{
        email: session.user.email,
        image: session.user.image,
        name: session.user.name,
      }}
      sessionId={sessionId}
      sessionless={sessionless}
    />
  );
}
