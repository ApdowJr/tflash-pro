import { randomBytes, randomUUID } from "node:crypto";
import { currentPrincipal } from "@/lib/identity";
import { getIntegration } from "@/lib/integrations/catalog";
import { buildAuthorizeUrl, newCodeVerifier, oauthConfigured, sealOAuthState } from "@/lib/integrations/oauth";
import { OAUTH_STATE_TTL_MS } from "@/lib/integrations/wire";
import { backToApp, callbackUrl, flowCookie } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const integration = getIntegration(id);
  if (!integration) return backToApp(request, { oauth: "unknown" });
  if (!oauthConfigured(integration.id)) return backToApp(request, { integration: integration.id, oauth: "unconfigured" });

  try {
    const flowId = randomUUID();
    const nonce = randomBytes(32).toString("hex");
    const verifier = newCodeVerifier(integration.id);
    const state = await sealOAuthState({ integrationId: integration.id, ownerId: principal.id, flowId, nonce, ...(verifier ? { verifier } : {}) });
    const authorizeUrl = await buildAuthorizeUrl({ integrationId: integration.id, redirectUri: callbackUrl(request), state, ...(verifier ? { verifier } : {}) });
    return new Response(null, {
      status: 302,
      headers: {
        location: authorizeUrl,
        "cache-control": "no-store",
        "set-cookie": flowCookie(request, flowId, nonce, Math.floor(OAUTH_STATE_TTL_MS / 1000)),
      },
    });
  } catch {
    return backToApp(request, { integration: integration.id, oauth: "misconfigured" });
  }
}
