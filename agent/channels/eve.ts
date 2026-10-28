import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn, vercelOidc } from "eve/channels/auth";
import { auth, authConfigured } from "@/lib/auth";
import { HEADER_TOKEN } from "@/lib/providers/selection";
import {
  HEADER_INTEGRATION_TOKENS,
  ATTR_INTEGRATION_TOKENS,
  sealedTokensFromHeader,
  sealedTokensToAttribute,
} from "@/lib/integrations/credentials";
import {
  selectionFromHeaders,
  selectionToAttributes,
} from "@/lib/providers/selection";

const betterAuthSession: AuthFn<Request> = async (request) => {
  // A broken/absent session must fall through to the other authenticators
  // instead of failing the whole request with a 500.
  const session = await auth.api.getSession({ headers: request.headers }).catch((error: unknown) => {
    console.error("[auth] session lookup failed:", error);
    return null;
  });
  if (!session) return null;

  const attributes: Record<string, string> = {
    email: session.user.email,
    name: session.user.name,
  };
  if (session.user.image) {
    attributes.picture = session.user.image;
  }

  return {
    attributes,
    authenticator: "better-auth:vercel",
    principalId: session.user.id,
    principalType: "user",
  };
};

/**
 * Every authenticated request carries the caller's provider/model choice.
 * `selectionFromHeaders` validates it against the server-side catalog, so a
 * client can only choose an allowlisted provider and a safe model id. The
 * dynamic model resolver reads these attributes from `ctx.session.auth`.
 */
const withModelSelection =
  (authenticate: AuthFn<Request>): AuthFn<Request> =>
  async (request) => {
    const result = await authenticate(request);
    if (!result) return result;
    const integrationTokens = sealedTokensToAttribute(
      // Still sealed: only the connection's auth resolver can open a token.
      sealedTokensFromHeader(request.headers.get(HEADER_INTEGRATION_TOKENS)),
    );
    return {
      ...result,
      attributes: {
        ...result.attributes,
        ...selectionToAttributes(selectionFromHeaders(request.headers)),
        ...(integrationTokens ? { [ATTR_INTEGRATION_TOKENS]: integrationTokens } : {}),
      },
    };
  };

/**
 * Bring-your-own-key guest access, used only when the deployment has no account
 * system at all (`authConfigured === false`).
 *
 * The request must carry a sealed provider key of its own — that is the whole
 * point: an anonymous caller can never spend the operator's server keys. The
 * principal id is derived from that sealed key, so it is stable for a browser
 * without identifying a person.
 */
const byokGuest: AuthFn<Request> = async (request) => {
  if (authConfigured) return null;
  const sealed = request.headers.get(HEADER_TOKEN);
  if (!sealed) return null;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sealed));
  const id = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return {
    attributes: {},
    authenticator: "guest:byok",
    principalId: `guest-${id}`,
    principalType: "anonymous",
  };
};

export default eveChannel({
  auth: [
    withModelSelection(betterAuthSession),
    withModelSelection(vercelOidc()),
    withModelSelection(byokGuest),
    withModelSelection(localDev()),
  ],
});
