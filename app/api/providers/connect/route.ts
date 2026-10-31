import { expectedPrincipalMatches } from "@/lib/security/expected-principal";
import { currentPrincipal } from "@/lib/identity";
import { getProvider } from "@/lib/providers/catalog";
import { sealCredential, validateBaseURL } from "@/lib/providers/credentials";
import { testConnection } from "@/lib/providers/live-models";
import {
  credentialFromInput,
  errorResponse,
  ProviderInputError,
} from "@/lib/providers/route-helpers";
import { guardRateLimit } from "@/lib/security/rate-limits";
import { apiRoute } from "@/lib/http/api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConnectResponse = {
  readonly ok: boolean;
  readonly providerId: string;
  /** Opaque, encrypted credential. Never contains a plaintext key. */
  readonly token?: string;
  readonly expiresAt?: number;
  readonly modelCount?: number;
  readonly latencyMs?: number;
  readonly message: string;
};

async function handlePost(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  if (!expectedPrincipalMatches(request, principal)) return Response.json({ ok: false, error: "Account changed. Reload to continue." }, { status: 409, headers: { "cache-control": "no-store" } });
  const limited = guardRateLimit("providerConnect", request, principal.id);
  if (limited) return limited;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(new Error("Invalid JSON body."));
  }

  const provider = getProvider(typeof payload.providerId === "string" ? payload.providerId : "");
  if (!provider) return errorResponse(new ProviderInputError("Unknown provider."));

  if (provider.kind === "gateway") {
    const body: ConnectResponse = {
      ok: true,
      providerId: provider.id,
      message: "Vercel AI Gateway needs no browser key.",
    };
    return Response.json(body);
  }

  const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const baseURL = typeof payload.baseURL === "string" ? payload.baseURL.trim() : undefined;
  const force = payload.force === true;

  try {
    const credential = await credentialFromInput(provider, { apiKey, baseURL }, { ownerId: principal.id });
    if (provider.requiresKey && !credential.apiKey && credential.source === "none") {
      throw new ProviderInputError(`Add an API key for ${provider.name} first.`);
    }
    const validatedBase = validateBaseURL(baseURL, provider);
    const started = Date.now();
    const check = await testConnection(provider, credential);
    const count = check.source === "live" ? check.models.length : 0;
    const note = !check.ok ? "Saved without verification; the connection test failed." : check.source === "static"
      ? (check.error ?? "Built-in suggestions only; the provider connection was not verified.")
      : `Model endpoint responded; ${count} models found.`;
    if (!check.ok && !force) {
      const body: ConnectResponse = {
        ok: false,
        providerId: provider.id,
        modelCount: count,
        latencyMs: check.latencyMs ?? Date.now() - started,
        message: check.error ?? "Connection test failed.",
      };
      return Response.json(body, { status: 400, headers: { "cache-control": "no-store" } });
    }

    // A server key needs no token unless a custom URL must be remembered.
    // In that case seal only the URL, never the operator-owned key.
    if (!apiKey && credential.source === "environment" && !validatedBase) {
      const body: ConnectResponse = {
        ok: true,
        providerId: provider.id,
        modelCount: count,
        latencyMs: check.latencyMs ?? Date.now() - started,
        message: `${provider.name} uses the server's API key. ${note}`,
      };
      return Response.json(body);
    }

    // For keyless/local endpoints with the default URL, no token is needed.
    if (!apiKey && !validatedBase) {
      const body: ConnectResponse = {
        ok: true,
        providerId: provider.id,
        modelCount: count,
        latencyMs: check.latencyMs ?? Date.now() - started,
        message: `${provider.name} is configured without a browser key. ${note}`,
      };
      return Response.json(body);
    }

    const sealed = await sealCredential({
      providerId: provider.id,
      ownerId: principal.id,
      apiKey,
      label: `${provider.name} · connected in this browser`,
      ...(validatedBase ? { baseURL: validatedBase } : {}),
    });
    const body: ConnectResponse = {
      ok: true,
      providerId: provider.id,
      token: sealed.token,
      expiresAt: sealed.expiresAt,
      modelCount: count,
      latencyMs: check.latencyMs ?? Date.now() - started,
      message: `${provider.name} credentials saved. ${note}`,
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = apiRoute("providers:connect", handlePost);
