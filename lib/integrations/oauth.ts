/**
 * In-app OAuth for the integrations catalog.
 *
 * "Connect" should mean *granting access on the provider's own consent screen*,
 * not pasting a secret. This module holds the provider registry (endpoints,
 * scopes, how client credentials are sent) and the two protocol steps:
 *
 *   buildAuthorizeUrl()  → where to send the browser
 *   exchangeCode()       → code → { access token, refresh token, expiry }
 *   refreshOAuthToken()  → refresh token → the same shape
 *
 * State is stateless: the sealed `state` parameter carries the integration id
 * and the PKCE verifier, so the callback needs no server-side session store.
 *
 * Server-only: reads `process.env` for client credentials.
 */
import { sealJson, openJson } from "@/lib/secrets";
import { OAUTH_STATE_TTL_MS, type OAuthEnvelope, type OAuthClientRegistration } from "./wire";

export type OAuthProvider = {
  /** Where the user approves access. */
  readonly authorizeUrl: string;
  /** Where the code is exchanged. */
  readonly tokenUrl: string;
  readonly setupUrl: string;
  readonly clientIdEnv?: string;
  /** Pinned vendor registration endpoint; never taken from a user URL. */
  readonly registrationUrl?: string;
  readonly resource?: string;
  /** Omitted for public clients that rely on PKCE alone. */
  readonly clientSecretEnv?: string;
  readonly scopes: readonly string[];
  /** Join character for `scope` (defaults to a space). */
  readonly scopeSeparator?: string;
  /** `S256` adds a code_challenge/code_verifier pair. */
  readonly pkce: boolean;
  /** How client credentials reach the token endpoint. */
  readonly tokenAuth: "basic" | "body" | "none";
  /** Legacy REST OAuth apps may use JSON; MCP token endpoints use form encoding. */
  readonly tokenFormat?: "form" | "json";
  readonly authorizeParams?: Readonly<Record<string, string>>;
  readonly tokenHeaders?: Readonly<Record<string, string>>;
  /** True when the provider hands back a refresh token. */
  readonly refreshable: boolean;
  /** Used to size the sealed envelope when the provider omits `expires_in`. */
  readonly assumedTokenTtlMs?: number;
};

/** MCP grants must come from the MCP authorization server, not an unrelated REST app. */
function mcpProvider(origin: string, input: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    authorizeUrl: `${origin}/authorize`,
    tokenUrl: `${origin}/token`,
    registrationUrl: `${origin}/register`,
    setupUrl: origin,
    scopes: [],
    pkce: true,
    tokenAuth: "none",
    refreshable: true,
    ...input,
  };
}

// Pinned to official vendor metadata, checked 2026-10-28. No arbitrary discovery
// URLs or redirects are accepted, especially on credential-bearing requests.
export const OAUTH_PROVIDERS: Readonly<Record<string, OAuthProvider>> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    setupUrl: "https://github.com/settings/developers",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
    scopes: ["repo", "read:org", "read:user", "workflow"],
    pkce: false,
    tokenAuth: "body",
    tokenHeaders: { accept: "application/json" },
    refreshable: false,
  },
  linear: mcpProvider("https://mcp.linear.app", {
    scopes: ["read", "write"], resource: "https://mcp.linear.app/mcp",
  }),
  notion: mcpProvider("https://mcp.notion.com", {
    scopes: ["default"], resource: "https://mcp.notion.com/mcp",
  }),
  sentry: mcpProvider("https://mcp.sentry.dev/oauth", {
    scopes: ["org:read", "project:write", "team:write", "event:write", "alerts:write"],
    resource: "https://mcp.sentry.dev/mcp",
  }),
  supabase: mcpProvider("https://api.supabase.com/v1/oauth", {
    registrationUrl: "https://api.supabase.com/platform/oauth/apps/register",
    tokenAuth: "basic",
    scopes: ["organizations:read", "projects:read", "projects:write", "database:write", "database:read", "analytics:read", "secrets:read", "edge_functions:read", "edge_functions:write", "environment:read", "environment:write", "storage:read", "storage:write"],
    resource: "https://mcp.supabase.com/mcp",
  }),
  neon: mcpProvider("https://mcp.neon.tech/api", {
    scopes: ["read", "write"], resource: "https://mcp.neon.tech/mcp",
  }),
  vercel: mcpProvider("https://vercel.com", {
    authorizeUrl: "https://vercel.com/oauth/authorize",
    tokenUrl: "https://vercel.com/api/login/oauth/token",
    registrationUrl: "https://vercel.com/api/login/oauth/register",
    scopes: ["openid", "offline_access"], resource: "https://mcp.vercel.com/",
  }),
  posthog: mcpProvider("https://oauth.posthog.com/oauth", {
    authorizeUrl: "https://oauth.posthog.com/oauth/authorize/",
    tokenUrl: "https://oauth.posthog.com/oauth/token/",
    registrationUrl: "https://oauth.posthog.com/oauth/register/",
    // Bounded product permissions, not identity/admin/billing permissions.
    scopes: ["project:read", "organization:read", "insight:read", "insight:write", "dashboard:read", "dashboard:write", "query:read", "event_definition:read", "person:read", "feature_flag:read", "feature_flag:write", "experiment:read", "experiment:write"],
    resource: "https://mcp.posthog.com/mcp",
  }),
  stripe: mcpProvider("https://access.stripe.com/mcp/oauth2", {
    scopes: ["mcp"], resource: "https://mcp.stripe.com",
  }),
  resend: mcpProvider("https://api.resend.com/oauth", {
    // Reading deliveries as well as sending requires full_access.
    scopes: ["full_access"],
  }),
};

function envValue(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function oauthProviderFor(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS[id];
}

/** A consent flow is supported, either through registration or configured app credentials. */
export function oauthConfigured(id: string): boolean {
  const provider = oauthProviderFor(id);
  if (!provider) return false;
  if (provider.registrationUrl) return true;
  if (!envValue(provider.clientIdEnv)) return false;
  if (provider.clientSecretEnv && !envValue(provider.clientSecretEnv)) return false;
  return true;
}

export function oauthClientId(id: string): string | undefined {
  const provider = oauthProviderFor(id);
  return envValue(provider?.clientIdEnv);
}

/** Register only when the user starts a flow; client secrets stay encrypted. */
export async function registerOAuthClient(integrationId: string, redirectUri: string): Promise<OAuthClientRegistration> {
  const provider = oauthProviderFor(integrationId);
  if (!provider?.registrationUrl) throw new Error("Automatic registration unavailable.");
  const method = provider.tokenAuth === "basic" ? "client_secret_basic" :
    provider.tokenAuth === "body" ? "client_secret_post" : "none";
  const response = await fetch(provider.registrationUrl, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Tflash",
      client_uri: new URL(redirectUri).origin,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      ...(provider.scopes.length ? { scope: provider.scopes.join(" ") } : {}),
    }),
  });
  if (!response.ok) throw new Error("Registration refused.");
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.client_id !== "string" || !raw.client_id || raw.client_id.length > 512 ||
    (raw.token_endpoint_auth_method !== undefined && raw.token_endpoint_auth_method !== method) ||
    (method !== "none" && (typeof raw.client_secret !== "string" || !raw.client_secret || raw.client_secret.length > 1024))) {
    throw new Error("Invalid registration response.");
  }
  return { clientId: raw.client_id, ...(method !== "none" ? { clientSecret: raw.client_secret as string } : {}) };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function codeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Sealed state: survives the redirect without a database, expires in 10 min. */
export async function sealOAuthState(input: {
  readonly integrationId: string;
  readonly ownerId: string;
  readonly flowId: string;
  readonly nonce: string;
  readonly verifier?: string;
  readonly client?: OAuthClientRegistration;
  readonly returnTo?: string;
}): Promise<string> {
  const { token } = await sealJson(
    {
      integrationId: input.integrationId,
      ownerId: input.ownerId,
      flowId: input.flowId,
      nonce: input.nonce,
      ...(input.verifier ? { verifier: input.verifier } : {}),
      ...(input.client ? { client: input.client } : {}),
      ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    },
    OAUTH_STATE_TTL_MS,
  );
  return token;
}

export async function openOAuthState(state: string | null): Promise<OAuthEnvelope | null> {
  if (!state) return null;
  return openJson<OAuthEnvelope>(state, (payload) =>
    typeof payload.integrationId === "string" && oauthProviderFor(payload.integrationId) !== undefined &&
    typeof payload.ownerId === "string" && payload.ownerId.length > 0 &&
    typeof payload.flowId === "string" && /^[a-f0-9-]{36}$/.test(payload.flowId) &&
    typeof payload.nonce === "string" && /^[a-f0-9]{64}$/.test(payload.nonce),
  );
}

export async function buildAuthorizeUrl(input: {
  readonly integrationId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly verifier?: string;
  readonly client?: OAuthClientRegistration;
}): Promise<string> {
  const provider = oauthProviderFor(input.integrationId);
  if (!provider) throw new Error(`No OAuth provider for ${input.integrationId}.`);
  const clientId = input.client?.clientId ?? oauthClientId(input.integrationId);
  if (!clientId) throw new Error(`${provider.clientIdEnv} is not set.`);

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (provider.resource) url.searchParams.set("resource", provider.resource);
  if (provider.scopes.length > 0) {
    url.searchParams.set("scope", provider.scopes.join(provider.scopeSeparator ?? " "));
  }
  for (const [key, value] of Object.entries(provider.authorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  if (provider.pkce && input.verifier) {
    url.searchParams.set("code_challenge", await codeChallenge(input.verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

/** Fresh PKCE verifier for a start request (empty when the provider has none). */
export function newCodeVerifier(integrationId: string): string | undefined {
  return oauthProviderFor(integrationId)?.pkce ? codeVerifier() : undefined;
}

export type OAuthTokens = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Wall-clock expiry of the access token, when the provider tells us. */
  readonly tokenExpiresAt?: number;
  readonly scope?: string;
};

type RawTokenResponse = {
  readonly access_token?: string;
  readonly token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number | string;
  readonly scope?: string | readonly string[];
  readonly error?: string;
  readonly error_description?: string;
  readonly message?: string;
};

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function parseTokens(
  provider: OAuthProvider,
  raw: RawTokenResponse,
  now = Date.now(),
): OAuthTokens | null {
  const accessToken = raw.access_token ?? raw.token;
  if (typeof accessToken !== "string" || !accessToken || /\s/.test(accessToken)) return null;
  const expiresIn = Number(raw.expires_in);
  const ttl =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn * 1000
      : provider.assumedTokenTtlMs;
  const scope = Array.isArray(raw.scope) ? raw.scope.join(" ") : raw.scope;
  return {
    accessToken,
    ...(raw.refresh_token ? { refreshToken: raw.refresh_token } : {}),
    ...(ttl ? { tokenExpiresAt: now + ttl } : {}),
    ...(typeof scope === "string" ? { scope } : {}),
  };
}

async function postTokenRequest(
  provider: OAuthProvider,
  clientId: string,
  clientSecret: string | undefined,
  body: Record<string, string>,
): Promise<{ tokens: OAuthTokens | null; error?: string }> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(provider.tokenHeaders ?? {}),
  };
  const payload = { ...body };
  if (provider.tokenAuth === "body" && clientSecret) {
    payload.client_id = clientId;
    payload.client_secret = clientSecret;
  }
  if (provider.tokenAuth === "body" && !clientSecret) payload.client_id = clientId;
  if (provider.tokenAuth === "basic" && clientSecret) {
    headers.authorization = basicAuth(clientId, clientSecret);
  } else if (provider.tokenAuth === "none") {
    payload.client_id = clientId;
  }

  if (provider.tokenFormat === "json") {
    headers["content-type"] = "application/json";
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  let response: Response;
  try {
    response = await fetch(provider.tokenUrl, {
      method: "POST",
      headers,
      body:
        provider.tokenFormat === "json"
          ? JSON.stringify(payload)
          : new URLSearchParams(payload).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { tokens: null, error: "unreachable" };
  }

  const text = await response.text();
  let raw: RawTokenResponse;
  try {
    raw = JSON.parse(text) as RawTokenResponse;
  } catch {
    // GitHub answers form-encoded when no Accept header survives a proxy.
    const params = new URLSearchParams(text);
    raw = Object.fromEntries(params) as RawTokenResponse;
  }

  if (!response.ok || raw.error) {
    return { tokens: null, error: raw.error ?? raw.error_description ?? "exchange_failed" };
  }
  return { tokens: parseTokens(provider, raw) };
}

export async function exchangeCode(input: {
  readonly integrationId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly verifier?: string;
  readonly client?: OAuthClientRegistration;
}): Promise<{ tokens: OAuthTokens | null; error?: string }> {
  const provider = oauthProviderFor(input.integrationId);
  const clientId = input.client?.clientId ?? oauthClientId(input.integrationId);
  if (!provider || !clientId) return { tokens: null, error: "not_configured" };

  const clientSecret = input.client?.clientSecret ?? envValue(provider.clientSecretEnv);
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  };
  if (provider.pkce && !input.verifier) return { tokens: null, error: "missing_verifier" };
  if (provider.pkce && input.verifier) body.code_verifier = input.verifier;
  if (provider.resource) body.resource = provider.resource;
  return postTokenRequest(provider, clientId, clientSecret, body);
}

export async function refreshOAuthToken(input: {
  readonly integrationId: string;
  readonly refreshToken: string;
  readonly client?: OAuthClientRegistration;
}): Promise<{ tokens: OAuthTokens | null; error?: string }> {
  const current = oauthProviderFor(input.integrationId);
  // Preserve renewal for grants issued by the earlier REST OAuth app flows.
  // New MCP grants always carry their registered client in the sealed record.
  const legacy: Readonly<Record<string, Partial<OAuthProvider>>> = {
    linear: { tokenUrl: "https://api.linear.app/oauth/token", clientIdEnv: "LINEAR_OAUTH_CLIENT_ID", clientSecretEnv: "LINEAR_OAUTH_CLIENT_SECRET", tokenAuth: "body", resource: undefined },
    supabase: { clientIdEnv: "SUPABASE_OAUTH_CLIENT_ID", clientSecretEnv: "SUPABASE_OAUTH_CLIENT_SECRET", tokenAuth: "basic", resource: undefined },
    posthog: { tokenUrl: `${process.env.POSTHOG_OAUTH_BASE_URL ?? "https://us.posthog.com"}/oauth/token`, clientIdEnv: "POSTHOG_OAUTH_CLIENT_ID", resource: undefined },
  };
  const provider = current && !input.client && legacy[input.integrationId]
    ? { ...current, ...legacy[input.integrationId] } : current;
  const clientId = input.client?.clientId ?? envValue(provider?.clientIdEnv);
  if (!provider || !clientId) return { tokens: null, error: "not_configured" };
  if (!provider.refreshable) return { tokens: null, error: "not_refreshable" };

  const clientSecret = input.client?.clientSecret ?? envValue(provider.clientSecretEnv);
  return postTokenRequest(provider, clientId, clientSecret, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    ...(provider.resource ? { resource: provider.resource } : {}),
  });
}
