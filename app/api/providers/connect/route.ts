import { currentUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/providers/catalog";
import { sealCredential, validateBaseURL } from "@/lib/providers/credentials";
import { testConnection } from "@/lib/providers/live-models";
import {
  credentialFromInput,
  errorResponse,
  ProviderInputError,
} from "@/lib/providers/route-helpers";

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

export async function POST(request: Request): Promise<Response> {
  if (!await currentUser()) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
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
    const credential = await credentialFromInput(provider, { apiKey, baseURL });
    if (provider.requiresKey && !credential.apiKey && credential.source === "none") {
      throw new ProviderInputError(`Add an API key for ${provider.name} first.`);
    }
    const validatedBase = validateBaseURL(baseURL, provider);
    const started = Date.now();
    const check = await testConnection(provider, credential);
    if (!check.ok && !force) {
      const body: ConnectResponse = {
        ok: false,
        providerId: provider.id,
        modelCount: check.models.length,
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
        modelCount: check.models.length,
        latencyMs: check.latencyMs ?? Date.now() - started,
        message: `${provider.name} is ready using the server's API key.`,
      };
      return Response.json(body);
    }

    // For keyless/local endpoints with the default URL, no token is needed.
    if (!apiKey && !validatedBase) {
      const body: ConnectResponse = {
        ok: true,
        providerId: provider.id,
        modelCount: check.models.length,
        latencyMs: check.latencyMs ?? Date.now() - started,
        message: `${provider.name} is ready on the server (no browser key needed).`,
      };
      return Response.json(body);
    }

    const sealed = await sealCredential({
      providerId: provider.id,
      apiKey,
      label: `${provider.name} · connected in this browser`,
      ...(validatedBase ? { baseURL: validatedBase } : {}),
    });
    const body: ConnectResponse = {
      ok: true,
      providerId: provider.id,
      token: sealed.token,
      expiresAt: sealed.expiresAt,
      modelCount: check.models.length,
      latencyMs: check.latencyMs ?? Date.now() - started,
      message: `${provider.name} connected. ${check.models.length} models available.`,
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
