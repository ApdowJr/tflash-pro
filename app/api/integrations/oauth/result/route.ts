import { expectedPrincipalMatches } from "@/lib/security/expected-principal";
import { currentPrincipal } from "@/lib/identity";
import { openJson } from "@/lib/secrets";
import { OAUTH_HANDOFF_COOKIE, OAUTH_HANDOFF_TTL_MS } from "@/lib/integrations/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Handoff = {
  readonly v: 1;
  readonly expiresAt: number;
  readonly grantExpiresAt?: number;
  readonly integrationId: string;
  readonly ownerId: string;
  readonly ownerKind?: "supabase" | "vercel";
  readonly token: string;
  readonly tokenExpiresAt?: number;
  readonly refreshable?: boolean;
  readonly label?: string;
};

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * One-shot read of the handoff cookie written by the OAuth callback.
 *
 * The cookie is deleted on read: the sealed record then lives in the browser's
 * own settings, exactly like a token the developer pasted.
 */
export async function GET(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ connected: false }, { status: 401 });
  if (!expectedPrincipalMatches(request, principal)) return Response.json({ connected: false }, { status: 409, headers: { "cache-control": "no-store" } });
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin))
    return Response.json({ connected: false }, { status: 403, headers: { "cache-control": "no-store" } });
  const raw = readCookie(request, OAUTH_HANDOFF_COOKIE);
  const clear = `${OAUTH_HANDOFF_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (!raw) {
    return Response.json(
      { connected: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const handoff = await openJson<Handoff>(raw, (payload) => typeof payload.integrationId === "string" && typeof payload.ownerId === "string");
  if (!handoff) {
    return Response.json(
      { connected: false },
      { headers: { "cache-control": "no-store", "set-cookie": clear } },
    );
  }

  // Never consume another account's still-valid handoff.
  if (handoff.ownerId !== principal.id || (handoff.ownerKind !== undefined && handoff.ownerKind !== principal.kind)) return Response.json({ connected: false }, { status: 403, headers: { "cache-control": "no-store" } });

  return Response.json(
    {
      connected: true,
      integrationId: handoff.integrationId,
      token: handoff.token,
      expiresAt: handoff.grantExpiresAt ?? handoff.expiresAt,
      ...(handoff.tokenExpiresAt ? { tokenExpiresAt: handoff.tokenExpiresAt } : {}),
      refreshable: handoff.refreshable === true,
      label: handoff.label ?? "Authorized",
      handoffTtlMs: OAUTH_HANDOFF_TTL_MS,
    },
    { headers: { "cache-control": "no-store", "set-cookie": clear } },
  );
}
