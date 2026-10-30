import { currentPrincipal } from "@/lib/identity";
import { AuthenticatedAgentChat } from "@/components/chat/authenticated-agent-chat";
import { LandingPage } from "@/components/marketing/landing-page";
import type { Metadata } from "next";

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
export default async function Page() {
  const principal = await currentPrincipal();
  if (!principal) return <LandingPage />;
  return <AuthenticatedAgentChat principal={principal} />;
}
