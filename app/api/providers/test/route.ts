import { expectedPrincipalMatches } from "@/lib/security/expected-principal";
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
  if (!expectedPrincipalMatches(request, principal)) return Response.json({ ok: false, error: "Account changed. Reload to continue." }, { status: 409, headers: { "cache-control": "no-store" } });
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
    const live = result.source === "live";
    const body: TestConnectionResponse = {
      ok: result.ok,
      providerId: provider.id,
      modelCount: live ? result.models.length : 0,
      latencyMs: result.latencyMs ?? Date.now() - started,
      sample: live ? result.models.slice(0, 6).map((model) => model.name ?? model.id) : [],
      message: !result.ok ? (result.error ?? "Connection failed.") : live
        ? `${provider.name} model endpoint responded · ${result.models.length} models found.`
        : (result.error ?? `${provider.name}: built-in suggestions only; the provider connection was not verified.`),
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
