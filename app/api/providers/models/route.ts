import { currentPrincipal } from "@/lib/identity";
import { getProvider, type ModelInfo } from "@/lib/providers/catalog";
import { fetchLiveModels } from "@/lib/providers/live-models";
import { credentialFromInput, errorResponse, ProviderInputError } from "@/lib/providers/route-helpers";
import { HEADER_TOKEN } from "@/lib/providers/selection";
import { guardRateLimit } from "@/lib/security/rate-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ModelsResponse = {
  readonly ok: boolean;
  readonly providerId: string;
  readonly models: readonly ModelInfo[];
  readonly source: "live" | "static";
  readonly latencyMs?: number;
  readonly error?: string;
};

export async function GET(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  const limited = guardRateLimit("providerModels", request, principal.id);
  if (limited) return limited;
  const providerId = new URL(request.url).searchParams.get("provider") ?? "";
  const provider = getProvider(providerId);
  if (!provider) return errorResponse(new ProviderInputError("Unknown provider."));

  try {
    const credential = await credentialFromInput(
      provider,
      { token: request.headers.get(HEADER_TOKEN) },
      { allowMissingKey: provider.publicModels === true, ownerId: principal.id },
    );
    const result = await fetchLiveModels(provider, credential);
    const body: ModelsResponse = {
      ok: result.ok,
      providerId: provider.id,
      models: result.models,
      source: result.source,
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // The built-in catalog always remains usable, even offline or without a key.
    const body: ModelsResponse = {
      ok: false,
      providerId: provider.id,
      models: [...provider.models],
      source: "static",
      error: error instanceof Error ? error.message : "Could not load models.",
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  }
}
