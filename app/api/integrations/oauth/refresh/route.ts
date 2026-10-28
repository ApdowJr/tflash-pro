import { currentPrincipal } from "@/lib/identity";
import { openIntegrationTokenForRefresh, sealIntegrationToken } from "@/lib/integrations/credentials";
import { getIntegration } from "@/lib/integrations/catalog";
import { refreshOAuthToken } from "@/lib/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESHABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Renews an expiring OAuth grant.
 *
 * The browser sends the sealed record it already holds; the server opens it,
 * talks to the provider, and returns a *new* sealed record. No plaintext token
 * ever crosses the wire in either direction.
 */
export async function POST(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ ok: false, message: "Sign in to continue." }, { status: 401 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ ok: false, message: "Expected JSON." }, { status: 415 });
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return Response.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
  }

  const record = await openIntegrationTokenForRefresh(
    typeof body.token === "string" ? body.token : undefined,
    principal.id,
  );
  if (!record) {
    return Response.json({ ok: false, message: "Unknown grant." }, { status: 400 });
  }
  if (!record.refreshToken) {
    return Response.json(
      { ok: false, message: "This connection cannot renew itself. Connect again." },
      { status: 409 },
    );
  }

  const integration = getIntegration(record.integrationId);
  if (!integration) {
    return Response.json({ ok: false, message: "Unknown integration." }, { status: 400 });
  }

  const { tokens } = await refreshOAuthToken({
    integrationId: integration.id,
    refreshToken: record.refreshToken,
    ...(record.oauthClient ? { client: record.oauthClient } : {}),
  });
  if (!tokens) {
    return Response.json(
      { ok: false, message: "The provider rejected the renewal. Connect again." },
      { status: 401 },
    );
  }

  const sealed = await sealIntegrationToken({
    integrationId: integration.id,
    ownerId: principal.id,
    token: tokens.accessToken,
    label: record.label ?? "Authorized",
    ...(record.oauthClient ? { oauthClient: record.oauthClient } : {}),
    ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
    ...(tokens.refreshToken ?? record.refreshToken
      ? { refreshToken: tokens.refreshToken ?? record.refreshToken }
      : {}),
    ttlMs: REFRESHABLE_TTL_MS,
  });

  return Response.json(
    {
      ok: true,
      token: sealed.token,
      expiresAt: sealed.expiresAt,
      ...(tokens.tokenExpiresAt ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
