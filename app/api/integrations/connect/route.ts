import { getIntegration, type IntegrationInfo } from "@/lib/integrations/catalog";
import { sealIntegrationToken } from "@/lib/integrations/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectRequest = {
  readonly integrationId?: unknown;
  readonly token?: unknown;
  /** Seal even when the service could not be reached from this server. */
  readonly force?: unknown;
};

type ConnectResponse = {
  readonly ok: boolean;
  readonly message: string;
  /** Opaque sealed token, safe to keep in the browser. */
  readonly token?: string;
  readonly expiresAt?: number;
  /** False when the token was sealed without a successful live check. */
  readonly verified?: boolean;
  /** True when retrying with `force: true` would succeed. */
  readonly canForce?: boolean;
};

const PROBE_TIMEOUT_MS = 8_000;

function readToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  if (token.length === 0 || token.length > 4096) return undefined;
  // Tokens are opaque, but they must be a single line without whitespace.
  if (/\s/.test(token)) return undefined;
  return token;
}

/**
 * Proves a pasted token works before it is sealed.
 *
 * Returns `"ok"`, `"rejected"` (the service answered 401/403 — the token is
 * wrong), or `"unreachable"` (network/DNS/timeout — usually a sandboxed build,
 * in which case the caller may still choose to seal it).
 */
async function probeToken(
  integration: IntegrationInfo,
  token: string,
): Promise<{ status: "ok" | "rejected" | "unreachable"; message?: string }> {
  const probe = integration.probe;
  if (!probe) return { status: "ok" };

  const headers: Record<string, string> = {
    accept: "application/json",
    ...probe.headers,
  };
  headers.authorization =
    probe.authorization === "raw" ? token : `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(probe.url, {
      method: probe.method ?? "GET",
      headers,
      ...(probe.body ? { body: probe.body } : {}),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.ok) return { status: "ok" };
    if (response.status === 401 || response.status === 403) {
      return { status: "rejected", message: `The service rejected this token (HTTP ${response.status}).` };
    }
    if (response.status === 404) {
      // Some APIs answer 404 for a valid token that can see nothing yet.
      return { status: "ok" };
    }
    return {
      status: "rejected",
      message: `Unexpected response from ${integration.name} (HTTP ${response.status}).`,
    };
  } catch {
    return {
      status: "unreachable",
      message: `Could not reach ${integration.name} from this server.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: ConnectRequest;
  try {
    body = (await request.json()) as ConnectRequest;
  } catch {
    return Response.json(
      { ok: false, message: "Expected a JSON body." } satisfies ConnectResponse,
      { status: 400 },
    );
  }

  const integration = getIntegration(String(body.integrationId ?? ""));
  if (!integration) {
    return Response.json(
      { ok: false, message: "Unknown integration." } satisfies ConnectResponse,
      { status: 400 },
    );
  }

  const token = readToken(body.token);
  if (!token) {
    return Response.json(
      {
        ok: false,
        message: "Paste a token without spaces or line breaks.",
      } satisfies ConnectResponse,
      { status: 400 },
    );
  }

  const probe = await probeToken(integration, token);
  const force = body.force === true;

  if (probe.status === "rejected") {
    return Response.json(
      {
        ok: false,
        canForce: false,
        message: probe.message ?? "That token did not work.",
      } satisfies ConnectResponse,
      { status: 401 },
    );
  }

  if (probe.status === "unreachable" && !force) {
    return Response.json(
      {
        ok: false,
        canForce: true,
        message: `${probe.message ?? "The service could not be reached."} Save it anyway?`,
      } satisfies ConnectResponse,
      { status: 502 },
    );
  }

  const sealed = await sealIntegrationToken({
    integrationId: integration.id,
    token,
  });

  return Response.json(
    {
      ok: true,
      message:
        probe.status === "ok"
          ? `${integration.name} connected.`
          : `${integration.name} saved without a live check.`,
      token: sealed.token,
      expiresAt: sealed.expiresAt,
      verified: probe.status === "ok",
    } satisfies ConnectResponse,
    { headers: { "cache-control": "no-store" } },
  );
}
