import { ATTR_MAX_STEPS, HEADER_MAX_STEPS, modelStepLimit } from "@/lib/usage-limits";
import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, type AuthFn } from "eve/channels/auth";
import { requestSupabase } from "@/lib/supabase/request";
import { vercelPrincipal } from "@/lib/auth-vercel";
import {
  CREATE_PROOF_HEADER,
  OWNER_PROOF_HEADER,
  verifyChatCreation,
  verifyChatOwnership,
} from "@/lib/security/chat-ownership";
import { selectionFromHeaders, selectionToAttributes } from "@/lib/providers/selection";
import {
  ATTR_INTEGRATION_TOKENS,
  HEADER_INTEGRATION_TOKENS,
  sealedTokensFromHeader,
  sealedTokensToAttribute,
} from "@/lib/integrations/credentials";

function sessionPath(request: Request): { create: true } | { sessionId: string } | null {
  const match = new URL(request.url).pathname.match(/\/eve\/v1\/session(?:\/([^/]+))?(?:\/|$)/);
  if (!match) return null;
  if (!match[1]) return { create: true };
  try {
    return { sessionId: decodeURIComponent(match[1]) };
  } catch {
    throw new ForbiddenError({ message: "Conversation not available." });
  }
}

function requireCreationProof(request: Request, principalId: string) {
  if (request.method !== "POST" || !verifyChatCreation(principalId, request.headers.get(CREATE_PROOF_HEADER))) {
    throw new ForbiddenError({ message: "Create a conversation from the Tflash app." });
  }
}

function requestAttributes(request: Request) {
  const integrationTokens = sealedTokensToAttribute(
    sealedTokensFromHeader(request.headers.get(HEADER_INTEGRATION_TOKENS)),
  );
  return {
    ...selectionToAttributes(selectionFromHeaders(request.headers)),
    [ATTR_MAX_STEPS]: String(modelStepLimit(request.headers.get(HEADER_MAX_STEPS))),
    ...(integrationTokens ? { [ATTR_INTEGRATION_TOKENS]: integrationTokens } : {}),
  };
}

/** Eve authenticates routes but does not itself enforce per-session ownership. */
const supabaseSession: AuthFn<Request> = async (request) => {
  if (!request.headers.get("cookie")) return null;
  const supabase = requestSupabase(request);
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) return null;

  const path = sessionPath(request);
  if (path && "create" in path) {
    requireCreationProof(request, user.id);
  } else if (path && "sessionId" in path) {
    const { data: chat, error: lookupError } = await supabase
      .from("tflash_chats")
      .select("owner_proof")
      .eq("session_id", path.sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError || !chat || !verifyChatOwnership(user.id, path.sessionId, chat.owner_proof)) {
      throw new ForbiddenError({ message: "Conversation not available." });
    }
  }

  return {
    authenticator: "supabase",
    principalId: user.id,
    principalType: "user",
    attributes: {
      email: user.email ?? "",
      name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
      ...requestAttributes(request),
    },
  };
};

/** Vercel accounts keep their signed chat index locally, not in Supabase RLS. */
const vercelSession: AuthFn<Request> = async (request) => {
  const principal = await vercelPrincipal(request.headers);
  if (!principal) return null;
  const path = sessionPath(request);
  if (path && "create" in path) {
    requireCreationProof(request, principal.id);
  } else if (path && "sessionId" in path &&
    !verifyChatOwnership(principal.id, path.sessionId, request.headers.get(OWNER_PROOF_HEADER))) {
    throw new ForbiddenError({ message: "Conversation not available." });
  }
  return {
    authenticator: "better-auth:vercel",
    principalId: principal.id,
    principalType: "user",
    attributes: { email: principal.email, name: principal.name, ...requestAttributes(request) },
  };
};

export default eveChannel({ auth: [supabaseSession, vercelSession] });
