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
import { OAUTH_STATE_TTL_MS, type OAuthEnvelope } from "./wire";

export type OAuthProvider = {
  /** Where the user approves access. */
  readonly authorizeUrl: string;
  /** Where the code is exchanged. */
  readonly tokenUrl: string;
  readonly setupUrl: string;
  readonly clientIdEnv: string;
  /** Omitted for public clients that rely on PKCE alone. */
  readonly clientSecretEnv?: string;
  readonly scopes: readonly string[];
  /** Join character for `scope`. Linear wants commas, everyone else spaces. */
  readonly scopeSeparator?: string;
  /** `S256` adds a code_challenge/code_verifier pair. */
  readonly pkce: boolean;
  /** How client credentials reach the token endpoint. */
  readonly tokenAuth: "basic" | "body" | "none";
  /** Notion's token endpoint takes JSON, everyone else form encoding. */
  readonly tokenFormat?: "form" | "json";
  readonly authorizeParams?: Readonly<Record<string, string>>;
  readonly tokenHeaders?: Readonly<Record<string, string>>;
  /** True when the provider hands back a refresh token. */
  readonly refreshable: boolean;
  /** Used to size the sealed envelope when the provider omits `expires_in`. */
  readonly assumedTokenTtlMs?: number;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Seven providers take a real OAuth grant. Neon, Stripe and Resend authenticate
 * with a scoped API key only, so those keep the "use a token" path.
 */
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
  linear: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    setupUrl: "https://linear.app/settings/api/applications/new",
    clientIdEnv: "LINEAR_OAUTH_CLIENT_ID",
    clientSecretEnv: "LINEAR_OAUTH_CLIENT_SECRET",
    scopes: ["read", "write"],
    scopeSeparator: ",",
    authorizeParams: { actor: "user" },
    pkce: true,
    tokenAuth: "body",
    refreshable: true,
    assumedTokenTtlMs: DAY,
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    setupUrl: "https://www.notion.so/my-integrations",
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
    scopes: [],
    authorizeParams: { owner: "user" },
    pkce: false,
    tokenAuth: "basic",
    tokenFormat: "json",
    refreshable: false,
  },
  sentry: {
    authorizeUrl: "https://sentry.io/oauth/authorize/",
    tokenUrl: "https://sentry.io/oauth/token/",
    setupUrl: "https://sentry.io/settings/account/api/applications/",
    clientIdEnv: "SENTRY_OAUTH_CLIENT_ID",
    clientSecretEnv: "SENTRY_OAUTH_CLIENT_SECRET",
    scopes: ["org:read", "project:read", "event:read", "event:write", "member:read"],
    pkce: false,
    tokenAuth: "body",
    refreshable: false,
  },
  vercel: {
    authorizeUrl: "https://vercel.com/oauth/authorize",
    tokenUrl: "https://api.vercel.com/v2/oauth/access_token",
    setupUrl: "https://vercel.com/dashboard/integrations/console",
    clientIdEnv: "VERCEL_INTEGRATION_CLIENT_ID",
    clientSecretEnv: "VERCEL_INTEGRATION_CLIENT_SECRET",
    scopes: [],
    pkce: false,
    tokenAuth: "body",
    refreshable: false,
  },
  supabase: {
    authorizeUrl: "https://api.supabase.com/v1/oauth/authorize",
    tokenUrl: "https://api.supabase.com/v1/oauth/token",
    setupUrl: "https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration",
    clientIdEnv: "SUPABASE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SUPABASE_OAUTH_CLIENT_SECRET",
    scopes: ["all"],
    pkce: true,
    tokenAuth: "basic",
    refreshable: true,
    assumedTokenTtlMs: DAY,
  },
  posthog: {
    authorizeUrl: `${process.env.POSTHOG_OAUTH_BASE_URL ?? "https://us.posthog.com"}/oauth/authorize`,
    tokenUrl: `${process.env.POSTHOG_OAUTH_BASE_URL ?? "https://us.posthog.com"}/oauth/token`,
    setupUrl: "https://us.posthog.com/settings/user-oauth-applications",
    clientIdEnv: "POSTHOG_OAUTH_CLIENT_ID",
    // PostHog OAuth apps are public clients: PKCE, no secret.
    scopes: [],
    pkce: true,
    tokenAuth: "none",
    refreshable: true,
    assumedTokenTtlMs: 60 * 60 * 1000,
  },
};

function envValue(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function oauthProviderFor(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS[id];
}

/** True when this deployment has the client credentials for the provider. */
export function oauthConfigured(id: string): boolean {
  const provider = oauthProviderFor(id);
  if (!provider) return false;
  if (!envValue(provider.clientIdEnv)) return false;
  if (provider.clientSecretEnv && !envValue(provider.clientSecretEnv)) return false;
  return true;
}

export function oauthClientId(id: string): string | undefined {
  const provider = oauthProviderFor(id);
  return envValue(provider?.clientIdEnv);
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
  readonly verifier?: string;
}): Promise<string> {
  const { token } = await sealJson(
    {
      integrationId: input.integrationId,
      ...(input.verifier ? { verifier: input.verifier } : {}),
    },
    OAUTH_STATE_TTL_MS,
  );
  return token;
}

export async function openOAuthState(state: string | null): Promise<OAuthEnvelope | null> {
  if (!state) return null;
  return openJson<OAuthEnvelope>(state, (payload) =>
    typeof payload.integrationId === "string" && oauthProviderFor(payload.integrationId) !== undefined,
  );
}

export async function buildAuthorizeUrl(input: {
  readonly integrationId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly verifier?: string;
}): Promise<string> {
  const provider = oauthProviderFor(input.integrationId);
  if (!provider) throw new Error(`No OAuth provider for ${input.integrationId}.`);
  const clientId = oauthClientId(input.integrationId);
  if (!clientId) throw new Error(`${provider.clientIdEnv} is not set.`);

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
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
  if (!accessToken) return null;
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
}): Promise<{ tokens: OAuthTokens | null; error?: string }> {
  const provider = oauthProviderFor(input.integrationId);
  const clientId = oauthClientId(input.integrationId);
  if (!provider || !clientId) return { tokens: null, error: "not_configured" };

  const clientSecret = envValue(provider.clientSecretEnv);
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  };
  if (provider.pkce && input.verifier) body.code_verifier = input.verifier;
  return postTokenRequest(provider, clientId, clientSecret, body);
}

export async function refreshOAuthToken(input: {
  readonly integrationId: string;
  readonly refreshToken: string;
}): Promise<{ tokens: OAuthTokens | null; error?: string }> {
  const provider = oauthProviderFor(input.integrationId);
  const clientId = oauthClientId(input.integrationId);
  if (!provider || !clientId) return { tokens: null, error: "not_configured" };
  if (!provider.refreshable) return { tokens: null, error: "not_refreshable" };

  const clientSecret = envValue(provider.clientSecretEnv);
  return postTokenRequest(provider, clientId, clientSecret, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}
