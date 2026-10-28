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
  readonly connected: boolean;
  /** Env vars the deployer can set for this integration. */
  readonly envKeys: readonly string[];
  /** Project-wide Connect availability, so the UI can explain the options. */
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
      connected: auth.mode !== "none",
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
