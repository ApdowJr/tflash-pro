import { currentPrincipal } from "@/lib/identity";
import { getProvider } from "@/lib/providers/catalog";
import { testConnection } from "@/lib/providers/live-models";
import { credentialFromInput, errorResponse, ProviderInputError } from "@/lib/providers/route-helpers";
import { guardRateLimit } from "@/lib/security/rate-limits";
import { apiRoute } from "@/lib/http/api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type TestConnectionResponse = {
  readonly ok: boolean;
  readonly providerId: string;
  readonly modelCount: number;
  readonly latencyMs: number;
  readonly sample: readonly string[];
  readonly message: string;
};

async function handlePost(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  const limited = guardRateLimit("providerTest", request, principal.id);
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

  const started = Date.now();
  try {
    const credential = await credentialFromInput(provider, payload, { ownerId: principal.id });
    const result = await testConnection(provider, credential);
    const body: TestConnectionResponse = {
      ok: result.ok,
      providerId: provider.id,
      modelCount: result.models.length,
      latencyMs: result.latencyMs ?? Date.now() - started,
      sample: result.models.slice(0, 6).map((model) => model.name ?? model.id),
      message: result.ok
        ? `Connected to ${provider.name} · ${result.models.length} models available`
        : (result.error ?? "Connection failed."),
    };
    return Response.json(body, {
      status: result.ok ? 200 : 400,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = apiRoute("providers:test", handlePost);
