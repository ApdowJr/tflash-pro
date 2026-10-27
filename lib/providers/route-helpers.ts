/** Helpers shared by the provider API routes. Server-only. */
import type { ProviderInfo } from "./catalog";
import {
  environmentBaseURL,
  environmentKey,
  openCredential,
  validateBaseURL,
  type ResolvedCredential,
} from "./credentials";

export class ProviderInputError extends Error {}

export type CredentialInput = {
  readonly apiKey?: unknown;
  readonly baseURL?: unknown;
  readonly token?: unknown;
};

function asTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  if (value.length > 4096) throw new ProviderInputError("That API key is too long.");
  return value.trim();
}

export async function credentialFromInput(
  provider: ProviderInfo,
  input: CredentialInput,
  options: { readonly allowMissingKey?: boolean } = {},
): Promise<ResolvedCredential> {
  const sealed = await openCredential(typeof input.token === "string" ? input.token : undefined);
  const browserKey = asTrimmed(input.apiKey) ?? (sealed?.providerId === provider.id ? sealed.apiKey : undefined);
  const envKey = environmentKey(provider);

  const explicitBase = typeof input.baseURL === "string" ? input.baseURL : undefined;
  const candidateBase =
    explicitBase ??
    (sealed?.providerId === provider.id ? sealed.baseURL : undefined) ??
    environmentBaseURL(provider) ??
    provider.baseURL;
  const baseURL = validateBaseURL(candidateBase, provider) ??
    (candidateBase === provider.baseURL ? provider.baseURL : null);

  if (!baseURL) {
    throw new ProviderInputError("Invalid endpoint URL. Use an https URL (or http for localhost).");
  }

  if (provider.kind === "gateway") {
    return { apiKey: "", baseURL: provider.baseURL, source: "none", label: "Vercel AI Gateway" };
  }

  if (browserKey) {
    return { apiKey: browserKey, baseURL, source: "browser", label: "Provided in browser" };
  }
  if (envKey) {
    return { apiKey: envKey, baseURL, source: "environment", label: "Configured on server" };
  }
  if (!provider.requiresKey || options.allowMissingKey) {
    return { apiKey: "", baseURL, source: "none", label: "Public model catalog" };
  }
  throw new ProviderInputError(
    `Add an API key for ${provider.name}, or set ${provider.envKey ?? "the provider key"} on the server.`,
  );
}

export function errorResponse(error: unknown): Response {
  const message =
    error instanceof ProviderInputError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected provider error.";
  return Response.json({ ok: false, error: message }, { status: error instanceof ProviderInputError ? 400 : 500 });
}
