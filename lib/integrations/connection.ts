/**
 * Turns the shared integration catalog into eve MCP connections.
 *
 * Server-only: this module resolves credentials, so it must never be imported
 * by a client component.
 *
 * Auth precedence for every integration, resolved on each call:
 *
 *   1. A token the developer pasted in Settings → Connections. It travels as a
 *      sealed envelope in the session attributes, is opened here only, and is
 *      never logged or sent to the model.
 *   2. `CONNECT_<ID>_CONNECTOR` — explicit Vercel Connect connector UID
 *      (user-scoped interactive OAuth unless `CONNECT_<ID>_APP_SCOPED=1`).
 *   3. A static bearer token from one of the integration's token env vars
 *      (app-scoped; the model never sees it).
 *   4. `VERCEL_PROJECT_ID` present — the project's own Vercel Connect
 *      connector, the behaviour the original Vercel/Supabase/Resend
 *      connections had.
 *   5. Nothing configured — the connection is still registered so the model
 *      can explain what is missing instead of guessing.
 */
import { connect } from "@vercel/connect/eve";
import {
  defineMcpClientConnection,
  type ConnectionAuthDefinition,
  type ConnectionAuthProvider,
} from "eve/connections";
import { always } from "eve/tools/approval";
import { integrationOrThrow, type IntegrationInfo } from "./catalog";
import { integrationTokenFor } from "./credentials";

export type IntegrationAuthMode =
  | "browser"
  | "connect"
  | "token"
  | "project-connect"
  | "none";

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

/** Server-side credential source, without the browser-token case. */
export type ServerAuthMode = Exclude<IntegrationAuthMode, "browser">;

/**
 * Where the deployment's credential for an integration comes from, without
 * exposing it. A developer's own sealed token is handled separately, per call,
 * in `authResolverFor`.
 */
export function resolveIntegrationAuth(
  integration: IntegrationInfo,
): ResolvedAuth & { readonly mode: ServerAuthMode } {
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

/** Server-configured credential: Vercel Connect or a static env token. */
function environmentAuthFor(integration: IntegrationInfo): ConnectionAuthProvider | undefined {
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
    default:
      return undefined;
  }
}

type AuthResolverContext = {
  readonly session: {
    readonly auth: {
      readonly current?: {
        readonly principalId?: string;
        readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
      } | null;
      readonly initiator?: {
        readonly principalId?: string;
        readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
      } | null;
    };
  };
};

/**
 * Per-caller credential, resolved on every tool call:
 *
 *   1. a token the developer pasted in Settings → Connections (sealed in their
 *      browser, opened here, never logged) — user-scoped;
 *   2. otherwise the deployment's own Connect connector or static token.
 */
function authResolverFor(integration: IntegrationInfo): ConnectionAuthDefinition {
  return async (ctx: AuthResolverContext): Promise<ConnectionAuthProvider> => {
    const current = ctx.session.auth.current ?? ctx.session.auth.initiator;
    const browserToken = await integrationTokenFor(integration.id, current?.attributes, current?.principalId);
    if (browserToken) {
      return {
        credentialOwner: "user",
        getToken: async () => ({ token: browserToken }),
      };
    }
    const environment = environmentAuthFor(integration);
    if (environment) return environment;
    // Nothing configured: let the server answer anonymously so the model sees
    // an honest 401 instead of a fabricated success.
    return {
      credentialOwner: "user",
      getToken: async () => {
        throw new Error(
          `${integration.name} is not connected. Open Settings → Connections and add a token, ` +
            `or configure ${integration.connectorEnvKey} on the server.`,
        );
      },
    };
  };
}

/**
 * Define the MCP connection for one catalog integration.
 *
 * Used by the thin files in `agent/connections/`, e.g.
 * `export default defineIntegrationConnection("github")`.
 */
export function defineIntegrationConnection(id: string) {
  const integration = integrationOrThrow(id);
  return defineMcpClientConnection({
    url: integration.mcpUrl,
    description: integration.description,
    auth: authResolverFor(integration),
    ...(integration.tools ? { tools: { allow: [...integration.tools] } } : {}),
    approval: always(),
  });
}
