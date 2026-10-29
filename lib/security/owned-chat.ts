import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { OWNER_PROOF_HEADER, verifyChatOwnership } from "@/lib/security/chat-ownership";

/** Authorize against the account's signed browser proof or its RLS-protected row. */
export async function ownedChat(request: Request, sessionId: string) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) return null;
  const principal = await currentPrincipal();
  if (!principal) return null;
  if (principal.kind === "vercel") {
    const proof = request.headers.get(OWNER_PROOF_HEADER);
    return verifyChatOwnership(principal.id, sessionId, proof)
      ? { kind: "vercel" as const, userId: principal.id, proof: proof! }
      : null;
  }
  const supabase = await serverSupabase();
  const { data: chat, error } = await supabase.from("tflash_chats")
    .select("owner_proof")
    .eq("session_id", sessionId)
    .eq("user_id", principal.id)
    .maybeSingle();
  if (error || !chat || !verifyChatOwnership(principal.id, sessionId, chat.owner_proof)) return null;
  return { kind: "supabase" as const, supabase, userId: principal.id };
}
