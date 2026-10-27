/**
 * Server-side credential handling for connected providers.
 *
 * Browser-supplied API keys are never stored in plaintext on the client. The
 * `/api/providers/connect` route validates a key and returns a short-lived,
 * AES-GCM encrypted token. The browser sends that opaque token with each chat
 * request; only this module can open it. Operator keys come from environment
 * variables and never leave the server.
 */
import type { ProviderInfo } from "./catalog";

export type SealedCredential = {
  readonly v: 1;
  readonly providerId: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly label: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

export type ResolvedCredential = {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly source: "browser" | "environment" | "none";
  readonly label: string;
};

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PREFIX = "v1";
const encoder = new TextEncoder();

function secretMaterial(): string {
  const secret =
    process.env.PROVIDER_KEYS_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    "ururka-local-development-only";
  return `ururka:provider-credentials:v1:${secret}`;
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretMaterial()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns a plain ArrayBuffer so it satisfies Web Crypto's BufferSource. */
function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function sealCredential(input: {
  readonly providerId: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly label?: string;
}): Promise<{ token: string; expiresAt: number }> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TOKEN_TTL_MS;
  const payload: SealedCredential = {
    v: 1,
    providerId: input.providerId,
    apiKey: input.apiKey,
    label: input.label ?? "Connected in browser",
    issuedAt,
    expiresAt,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    token: `${TOKEN_PREFIX}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`,
    expiresAt,
  };
}

/** Returns null for expired, tampered, or malformed tokens. */
export async function openCredential(token: string | undefined): Promise<SealedCredential | null> {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[1]!) },
      await encryptionKey(),
      fromBase64Url(parts[2]!),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SealedCredential;
    if (
      payload.v !== 1 ||
      typeof payload.providerId !== "string" ||
      typeof payload.apiKey !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Only accepts URLs that are safe to call from the server. */
export function validateBaseURL(raw: string | undefined, provider: ProviderInfo): string | null {
  if (!raw) return null;
  if (raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol === "http:" && !isLoopback && process.env.NODE_ENV === "production") {
    return null;
  }
  if (host === "169.254.169.254" || host.endsWith(".internal") || host === "metadata.google.internal") {
    return null;
  }
  if (!provider.customBaseURL) return null;
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function environmentKey(provider: ProviderInfo): string | undefined {
  const value = provider.envKey ? process.env[provider.envKey] : undefined;
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function environmentBaseURL(provider: ProviderInfo): string | undefined {
  if (!provider.customBaseURL) return undefined;
  const raw = process.env[`${provider.id.toUpperCase()}_BASE_URL`];
  return validateBaseURL(raw, provider) ?? undefined;
}

export function hasEnvironmentKey(provider: ProviderInfo): boolean {
  if (provider.kind === "gateway") return true;
  return environmentKey(provider) !== undefined || environmentBaseURL(provider) !== undefined;
}

/**
 * Browser credentials take precedence over operator environment keys, so a
 * user can always override the deployment default from the settings dialog.
 */
export async function resolveCredential(
  provider: ProviderInfo,
  token?: string,
): Promise<ResolvedCredential> {
  const sealed = await openCredential(token);
  if (sealed && sealed.providerId === provider.id) {
    return {
      apiKey: sealed.apiKey,
      baseURL: validateBaseURL(sealed.baseURL, provider) ?? provider.baseURL,
      source: "browser",
      label: sealed.label,
    };
  }

  const envKey = environmentKey(provider);
  const envBaseURL = environmentBaseURL(provider);
  if (envKey || envBaseURL) {
    return {
      apiKey: envKey ?? "",
      baseURL: envBaseURL ?? provider.baseURL,
      source: "environment",
      label: "Configured on server",
    };
  }

  if (!provider.requiresKey && provider.kind !== "gateway") {
    return {
      apiKey: "",
      baseURL: provider.baseURL,
      source: "none",
      label: "No key required",
    };
  }

  if (provider.kind === "gateway") {
    return {
      apiKey: "",
      baseURL: provider.baseURL,
      source: "none",
      label: "Vercel AI Gateway",
    };
  }

  throw new Error(
    `${provider.name} is not connected. Open Settings → Providers, add your API key, ` +
      `or set ${provider.envKey ?? "the provider API key"} on the server.`,
  );
}
