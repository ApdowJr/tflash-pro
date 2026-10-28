import { getIntegration } from "@/lib/integrations/catalog";
import {
  buildAuthorizeUrl,
  newCodeVerifier,
  oauthConfigured,
  sealOAuthState,
} from "@/lib/integrations/oauth";
import { backToApp, callbackUrl } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends the browser to the provider's own consent screen.
 *
 * Nothing secret leaves the server here: the redirect carries the public
 * client id, the scopes, and a sealed `state` that holds the PKCE verifier.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const integration = getIntegration(id);
  if (!integration) return backToApp(request, { oauth: "unknown" });

  if (!oauthConfigured(integration.id)) {
    return backToApp(request, { integration: integration.id, oauth: "unconfigured" });
  }

  try {
    const verifier = newCodeVerifier(integration.id);
    const state = await sealOAuthState({
      integrationId: integration.id,
      ...(verifier ? { verifier } : {}),
    });
    const authorizeUrl = await buildAuthorizeUrl({
      integrationId: integration.id,
      redirectUri: callbackUrl(request),
      state,
      ...(verifier ? { verifier } : {}),
    });
    return new Response(null, {
      status: 302,
      headers: { location: authorizeUrl, "cache-control": "no-store" },
    });
  } catch {
    return backToApp(request, { integration: integration.id, oauth: "misconfigured" });
  }
}
