import { sealJson } from "@/lib/secrets";
import { getIntegration } from "@/lib/integrations/catalog";
import { sealIntegrationToken } from "@/lib/integrations/credentials";
import { exchangeCode, openOAuthState } from "@/lib/integrations/oauth";
import { OAUTH_HANDOFF_COOKIE, OAUTH_HANDOFF_TTL_MS } from "@/lib/integrations/wire";
import { backToApp, callbackUrl } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Envelope lifetime: refreshed grants survive longer than pasted tokens. */
const REFRESHABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function handoffCookie(request: Request, value: string): string {
  const secure = callbackUrl(request).startsWith("https://") ? "; Secure" : "";
  return [
    `${OAUTH_HANDOFF_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(OAUTH_HANDOFF_TTL_MS / 1000)}`,
  ].join("; ") + secure;
}

/**
 * Provider redirect target.
 *
 * The access token is sealed immediately and handed to the app through a
 * short-lived, HttpOnly cookie, so it never appears in a URL, a log, or the
 * history of the browser that just authorized it.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const state = await openOAuthState(params.get("state"));
  if (!state) return backToApp(request, { oauth: "state" });

  const integration = getIntegration(state.integrationId);
  if (!integration) return backToApp(request, { oauth: "unknown" });

  if (params.get("error")) {
    return backToApp(request, { integration: integration.id, oauth: "denied" });
  }
  const code = params.get("code");
  if (!code) return backToApp(request, { integration: integration.id, oauth: "missing_code" });

  const { tokens } = await exchangeCode({
    integrationId: integration.id,
    code,
    redirectUri: callbackUrl(request),
    ...(state.verifier ? { verifier: state.verifier } : {}),
  });
  if (!tokens) return backToApp(request, { integration: integration.id, oauth: "exchange" });

  const sealed = await sealIntegrationToken({
    integrationId: integration.id,
    token: tokens.accessToken,
    label: `Authorized ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`,
    ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ttlMs: tokens.refreshToken ? REFRESHABLE_TTL_MS : STATIC_TTL_MS,
  });

  const handoff = await sealJson(
    {
      integrationId: integration.id,
      token: sealed.token,
      expiresAt: sealed.expiresAt,
      ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
      refreshable: Boolean(tokens.refreshToken),
      label: tokens.scope ? `Authorized · ${tokens.scope}` : "Authorized",
    },
    OAUTH_HANDOFF_TTL_MS,
  );

  const response = backToApp(request, { integration: integration.id, connected: "1" });
  response.headers.append("set-cookie", handoffCookie(request, handoff.token));
  response.headers.set("cache-control", "no-store");
  return response;
}
