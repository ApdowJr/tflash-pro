import { currentPrincipal } from "@/lib/identity";
import { INTEGRATIONS, integrationEnvKeys } from "@/lib/integrations/catalog";
import { resolveIntegrationAuth, type ServerAuthMode } from "@/lib/integrations/connection";
import { oauthConfigured, oauthProviderFor } from "@/lib/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Secret-free status for the Connections panel.
 *
 * Reports *how* each integration is authenticated (or that it is not), never
 * the credential itself.
 */
export type IntegrationStatusItem = {
  readonly id: string;
  /** How the *server* authenticates this connection; the browser may add its own token. */
  readonly mode: ServerAuthMode;
  /** Explicit server setting exists; it has not been checked against the service. */
  readonly configured: boolean;
  /** Env vars the deployer can set for this integration. */
  readonly envKeys: readonly string[];
  /** A project ID is present. This does not verify a Connect installation. */
  readonly connectAvailable: boolean;
  /** True when this service can be authorized with OAuth *and* the deployment has credentials. */
  readonly oauthAvailable: boolean;
  /** Env vars the operator must set to turn OAuth on for this service. */
  readonly oauthEnvKeys?: readonly string[];
  /** Where to register the OAuth app. */
  readonly oauthSetupUrl?: string;
};

export type IntegrationsStatusResponse = {
  readonly integrations: readonly IntegrationStatusItem[];
  readonly serverTime: number;
};

export async function GET(): Promise<Response> {
  if (!await currentPrincipal()) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const connectAvailable = Boolean(process.env.VERCEL_PROJECT_ID);
  const integrations: IntegrationStatusItem[] = INTEGRATIONS.map((integration) => {
    const auth = resolveIntegrationAuth(integration);
    const provider = oauthProviderFor(integration.id);
    const oauthEnvKeys = provider
      ? [
          provider.clientIdEnv,
          ...(provider.clientSecretEnv ? [provider.clientSecretEnv] : []),
        ]
      : undefined;
    return {
      id: integration.id,
      mode: auth.mode,
      // A project ID alone only suggests a fallback; it does not prove that
      // the integration is installed, authorized, or reachable.
      configured: auth.mode === "connect" || auth.mode === "token",
      envKeys: integrationEnvKeys(integration),
      connectAvailable,
      oauthAvailable: oauthConfigured(integration.id),
      ...(oauthEnvKeys ? { oauthEnvKeys } : {}),
      ...(provider ? { oauthSetupUrl: provider.setupUrl } : {}),
    };
  });

  const body: IntegrationsStatusResponse = {
    integrations,
    serverTime: Date.now(),
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
