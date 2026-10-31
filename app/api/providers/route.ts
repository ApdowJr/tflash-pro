import { expectedPrincipalMatches } from "@/lib/security/expected-principal";
import { currentPrincipal } from "@/lib/identity";
import {
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  type ModelInfo,
  type ProviderInfo,
} from "@/lib/providers/catalog";
import { hasEnvironmentKey } from "@/lib/providers/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ProviderCatalogItem = Omit<ProviderInfo, "models" | "modelHeaders"> & {
  readonly models: readonly ModelInfo[];
  readonly envConfigured: boolean;
};

export type ProviderCatalogResponse = {
  readonly providers: readonly ProviderCatalogItem[];
  readonly defaultProviderId: string;
  readonly serverTime: number;
};

export async function GET(request?: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  if (!expectedPrincipalMatches(request, principal)) return Response.json({ ok: false, error: "Account changed. Reload to continue." }, { status: 409, headers: { "cache-control": "no-store" } });
  const providers: ProviderCatalogItem[] = PROVIDERS.map((provider) => ({
    ...provider,
    models: [...provider.models],
    envConfigured: hasEnvironmentKey(provider),
  }));
  const body: ProviderCatalogResponse = {
    providers,
    defaultProviderId: DEFAULT_PROVIDER_ID,
    serverTime: Date.now(),
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
