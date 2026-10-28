import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, type AuthFn } from "eve/channels/auth";
import { requestSupabase } from "@/lib/supabase/request";
import {
  CREATE_PROOF_HEADER,
  verifyChatCreation,
  verifyChatOwnership,
} from "@/lib/security/chat-ownership";
import { selectionFromHeaders, selectionToAttributes } from "@/lib/providers/selection";

/**
 * Eve authenticates routes, but does not itself enforce session ownership.
 * Check both Supabase RLS and a server-signed binding on EVERY session route,
 * including streams, controls, and subagent streams. Do not fall back to the
 * synthetic local-dev principal on a multi-user deployment.
 */
const supabaseSession: AuthFn<Request> = async (request) => {
  if (!request.headers.get("cookie")) return null;
  const supabase = requestSupabase(request);
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) return null;

  const path = new URL(request.url).pathname;
  const match = path.match(/\/eve\/v1\/session(?:\/([^/]+))?(?:\/|$)/);
  if (match) {
    const rawSessionId = match[1];
    if (!rawSessionId) {
      if (request.method !== "POST" || !verifyChatCreation(user.id, request.headers.get(CREATE_PROOF_HEADER))) {
        throw new ForbiddenError({ message: "Create a conversation from the Tflash app." });
      }
    } else {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(rawSessionId);
      } catch {
        throw new ForbiddenError({ message: "Conversation not available." });
      }
      const { data: chat, error: lookupError } = await supabase
        .from("tflash_chats")
        .select("owner_proof")
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (lookupError || !chat || !verifyChatOwnership(user.id, sessionId, chat.owner_proof)) {
        throw new ForbiddenError({ message: "Conversation not available." });
      }
    }
  }

  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  return {
    authenticator: "supabase",
    principalId: user.id,
    principalType: "user",
    attributes: {
      email: user.email ?? "",
      name,
      ...selectionToAttributes(selectionFromHeaders(request.headers)),
    },
  };
};

export default eveChannel({ auth: [supabaseSession] });
