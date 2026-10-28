import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn, vercelOidc } from "eve/channels/auth";
import { auth } from "@/lib/auth";
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
  const session = await auth.api.getSession({ headers: request.headers });
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

export default eveChannel({
  auth: [
    withModelSelection(betterAuthSession),
    withModelSelection(vercelOidc()),
    withModelSelection(localDev()),
  ],
});
