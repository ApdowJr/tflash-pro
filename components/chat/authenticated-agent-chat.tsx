import { redirect, notFound } from "next/navigation";
import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { verifyChatOwnership } from "@/lib/security/chat-ownership";
import { AppSettingsProvider } from "@/components/settings/app-settings";
import { AgentChat } from "./agent-chat";

export async function AuthenticatedAgentChat({ sessionId, sessionless }: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const principal = await currentPrincipal();
  if (!principal) {
    const next = sessionId ? `/s/${encodeURIComponent(sessionId)}` : "/";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (sessionId && principal.kind === "supabase") {
    const supabase = await serverSupabase();
    const { data: chat } = await supabase.from("tflash_chats")
      .select("owner_proof").eq("session_id", sessionId).eq("user_id", principal.id).maybeSingle();
    // Never reveal whether another user's conversation exists.
    if (!chat || !verifyChatOwnership(principal.id, sessionId, chat.owner_proof)) notFound();
  }
  // Vercel chat proofs live in account-scoped browser storage and are checked
  // by Eve on every session route, including streams and controls.
  return (
    <AppSettingsProvider userId={principal.id} accountKind={principal.kind}>
      <AgentChat account={principal} sessionId={sessionId} sessionless={sessionless} />
    </AppSettingsProvider>
  );
}
