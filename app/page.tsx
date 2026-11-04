import { currentPrincipal } from "@/lib/identity";
import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";
import { LandingPage } from "@/components/marketing/landing-page";
import type { Metadata } from "next";
import { parseAgentMode } from "@/lib/agent-modes";

// The session (and whether accounts are configured at all) is per request;
// prerendering this route would freeze whichever answer the build machine saw.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Tflash — an AI workspace for Somali and English" },
  alternates: { canonical: "/" },
};

/**
 * The front door is public: signed-out visitors get the landing page, signed-in
 * accounts go straight to a new chat. `/` stays the single canonical entry so
 * existing links and bookmarks keep working.
 */
export default async function Page({ searchParams }: {
  readonly searchParams: Promise<{ readonly mode?: string | readonly string[] }>;
}) {
  const principal = await currentPrincipal();
  if (!principal) return <LandingPage />;
  const params = await searchParams;
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  return <AuthenticatedAgentChat initialMode={parseAgentMode(requestedMode)} principal={principal} />;
}
