import { headers } from "next/headers";
import { auth, authConfigured, missingAuthEnv } from "@/lib/auth";
import { AccountsUnavailable } from "@/components/auth/accounts-unavailable";
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

  // No auth credentials on this deployment: serve the workspace instead of a
  // 500, and say once what the operator has to set to turn accounts on.
  if (!authConfigured) {
    return (
      <>
        <AgentChat sessionId={sessionId} sessionless={sessionless} />
        <AccountsUnavailable missing={missingAuthEnv()} />
      </>
    );
  }

  // A session lookup can fail for reasons that are not the visitor's fault
  // (host not yet trusted, rotated secret, provider hiccup). Treat those as
  // "not signed in" so the page still renders something real.
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.error("[auth] session lookup failed:", error);
  }
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
