import { currentPrincipal } from "@/lib/identity";
import { openIntegrationTokenForRefresh, sealIntegrationToken } from "@/lib/integrations/credentials";
import { getIntegration } from "@/lib/integrations/catalog";
import { refreshOAuthToken } from "@/lib/integrations/oauth";
import { readBoundedJson } from "@/lib/bounded-json";

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
  const expectedId = request.headers.get("x-tflash-expected-user-id");
  const expectedKind = request.headers.get("x-tflash-expected-account-kind");
  if ((expectedId !== null && expectedId !== principal.id) || (expectedKind !== null && expectedKind !== principal.kind)) {
    return Response.json({ ok: false, message: "Account changed. Reload to continue." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  const input = await readBoundedJson(request, 32 * 1024);
  if (!input.ok) return Response.json({ ok: false, message: input.error }, { status: input.status, headers: { "cache-control": "no-store" } });
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) return Response.json({ ok: false, message: "Expected a JSON body." }, { status: 400 });
  const body = input.value as { token?: unknown };

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
      { ok: false, message: "The renewal outcome could not be confirmed. Do not retry automatically." },
      { status: 503, headers: { "cache-control": "no-store" } },
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
