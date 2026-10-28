import { currentUser } from "@/lib/supabase/server";
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

export async function GET(): Promise<Response> {
  if (!await currentUser()) return Response.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
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
