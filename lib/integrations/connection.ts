/**
 * Turns the shared integration catalog into eve MCP connections.
 *
 * Server-only: this module resolves credentials, so it must never be imported
 * by a client component.
 *
 * Auth precedence for every integration:
 *
 *   1. `CONNECT_<ID>_CONNECTOR`  — explicit Vercel Connect connector UID
 *      (user-scoped interactive OAuth unless `CONNECT_<ID>_APP_SCOPED=1`).
 *   2. A static bearer token from one of the integration's token env vars
 *      (app-scoped; the model never sees it).
 *   3. `VERCEL_PROJECT_ID` present — the project's own Vercel Connect
 *      connector, the behaviour the original Vercel/Supabase/Resend
 *      connections had.
 *   4. Nothing configured — the connection is still registered so the model
 *      can explain what is missing instead of guessing.
 */
import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection, type ConnectionAuthDefinition } from "eve/connections";
import { always, once } from "eve/tools/approval";
import { integrationOrThrow, type IntegrationAccess, type IntegrationInfo } from "./catalog";

export type IntegrationAuthMode = "connect" | "token" | "project-connect" | "none";

type ResolvedAuth = {
  readonly mode: IntegrationAuthMode;
  /** The connector UID handed to `connect(...)`, when relevant. */
  readonly connector?: string;
  /** Name of the env var that supplied the static token, when relevant. */
  readonly tokenEnvKey?: string;
};

function envValue(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function truthyEnv(name: string): boolean {
  const value = envValue(name);
  return value === "1" || value === "true" || value === "yes";
}

/** Where the credential for an integration comes from, without exposing it. */
export function resolveIntegrationAuth(integration: IntegrationInfo): ResolvedAuth {
  const explicitConnector = envValue(integration.connectorEnvKey);
  if (explicitConnector) return { connector: explicitConnector, mode: "connect" };

  for (const key of integration.tokenEnvKeys) {
    if (envValue(key)) return { mode: "token", tokenEnvKey: key };
  }

  const projectId = envValue("VERCEL_PROJECT_ID");
  if (projectId) {
    return {
      connector: `${integration.connectService}/${projectId}`,
      mode: "project-connect",
    };
  }

  return { mode: "none" };
}

export function isIntegrationConnected(integration: IntegrationInfo): boolean {
  return resolveIntegrationAuth(integration).mode !== "none";
}

/**
 * Approval gate by blast radius.
 *
 * `read` connections never interrupt, `write` connections ask once per session,
 * and `destructive` connections (money, databases, outbound email) ask every
 * time — approval fatigue is a real failure mode, but so is a silent refund.
 */
function approvalFor(access: IntegrationAccess) {
  switch (access) {
    case "read":
      return undefined;
    case "write":
      return once();
    case "destructive":
      return always();
  }
}

function authFor(integration: IntegrationInfo): ConnectionAuthDefinition | undefined {
  const resolved = resolveIntegrationAuth(integration);
  switch (resolved.mode) {
    case "connect":
    case "project-connect": {
      const connector = resolved.connector;
      if (!connector) return undefined;
      return truthyEnv(integration.appScopeEnvKey)
        ? connect({ connector, principalType: "app" })
        : connect(connector);
    }
    case "token": {
      const key = resolved.tokenEnvKey;
      return {
        credentialOwner: "app",
        getToken: async () => {
          const token = envValue(key);
          if (!token) throw new Error(`${key} is not set.`);
          return { token };
        },
      };
    }
    case "none":
      return undefined;
  }
}

/**
 * Define the MCP connection for one catalog integration.
 *
 * Used by the thin files in `agent/connections/`, e.g.
 * `export default defineIntegrationConnection("github")`.
 */
export function defineIntegrationConnection(id: string) {
  const integration = integrationOrThrow(id);
  const auth = authFor(integration);
  return defineMcpClientConnection({
    url: integration.mcpUrl,
    description: integration.description,
    ...(auth ? { auth } : {}),
    ...(integration.tools ? { tools: { allow: [...integration.tools] } } : {}),
    ...(approvalFor(integration.access) ? { approval: approvalFor(integration.access) } : {}),
  });
}
