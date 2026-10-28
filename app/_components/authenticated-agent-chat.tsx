import { redirect, notFound } from "next/navigation";
import { currentUser, serverSupabase } from "@/lib/supabase/server";
import { verifyChatOwnership } from "@/lib/security/chat-ownership";
import { AppSettingsProvider } from "@/components/app/settings-provider";
import { AgentChat } from "./agent-chat";

export async function AuthenticatedAgentChat({
  sessionId,
  sessionless,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const user = await currentUser();
  if (!user) {
    const next = sessionId ? `/s/${encodeURIComponent(sessionId)}` : "/";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (sessionId) {
    const supabase = await serverSupabase();
    const { data: chat } = await supabase.from("tflash_chats")
      .select("owner_proof")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    // Do not reveal whether another user's session exists.
    if (!chat || !verifyChatOwnership(user.id, sessionId, chat.owner_proof)) notFound();
  }

  const name = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name.trim()
    : (user.email?.split("@")[0] || "Member");

  return (
    <AppSettingsProvider userId={user.id}>
      <AgentChat
        sessionId={sessionId}
        sessionless={sessionless}
        user={{ id: user.id, name, email: user.email ?? "" }}
      />
    </AppSettingsProvider>
  );
}
