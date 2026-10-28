import { currentPrincipal } from "@/lib/identity";
import { sealJson } from "@/lib/secrets";
import { getIntegration } from "@/lib/integrations/catalog";
import { sealIntegrationToken } from "@/lib/integrations/credentials";
import { exchangeCode, openOAuthState } from "@/lib/integrations/oauth";
import { OAUTH_HANDOFF_COOKIE, OAUTH_HANDOFF_TTL_MS } from "@/lib/integrations/wire";
import { backToApp, callbackUrl, constantTimeEqual, flowCookie, flowCookieName, readCookie } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const REFRESHABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const state = await openOAuthState(params.get("state"));
  if (!state || state.ownerId !== principal.id || !constantTimeEqual(readCookie(request, flowCookieName(state.flowId)), state.nonce)) {
    return backToApp(request, { oauth: "state" });
  }
  const finish = (response: Response) => {
    response.headers.append("set-cookie", flowCookie(request, state.flowId, "", 0));
    return response;
  };
  try {
    const integration = getIntegration(state.integrationId);
    if (!integration) return finish(backToApp(request, { oauth: "unknown" }, state.returnTo));
    if (params.get("error")) return finish(backToApp(request, { integration: integration.id, oauth: "denied" }, state.returnTo));
    const code = params.get("code");
    if (!code) return finish(backToApp(request, { integration: integration.id, oauth: "missing_code" }, state.returnTo));
    const { tokens } = await exchangeCode({ integrationId: integration.id, code, redirectUri: callbackUrl(request), ...(state.client ? { client: state.client } : {}), ...(state.verifier ? { verifier: state.verifier } : {}) });
    if (!tokens) return finish(backToApp(request, { integration: integration.id, oauth: "exchange" }, state.returnTo));

    const sealed = await sealIntegrationToken({
      integrationId: integration.id, ownerId: principal.id, token: tokens.accessToken,
      label: "Authorized",
      ...(state.client ? { oauthClient: state.client } : {}),
      ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ttlMs: tokens.refreshToken ? REFRESHABLE_TTL_MS : STATIC_TTL_MS,
    });
    const handoff = await sealJson({
      integrationId: integration.id, ownerId: principal.id, token: sealed.token, grantExpiresAt: sealed.expiresAt,
      ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
      refreshable: Boolean(tokens.refreshToken), label: "Authorized",
    }, OAUTH_HANDOFF_TTL_MS);
    const response = backToApp(request, { integration: integration.id, connected: "1" }, state.returnTo);
    const secure = callbackUrl(request).startsWith("https://") ? "; Secure" : "";
    response.headers.append("set-cookie", `${OAUTH_HANDOFF_COOKIE}=${handoff.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(OAUTH_HANDOFF_TTL_MS / 1000)}${secure}`);
    return finish(response);
  } catch {
    return finish(backToApp(request, { integration: state.integrationId, oauth: "misconfigured" }, state.returnTo));
  }
}
