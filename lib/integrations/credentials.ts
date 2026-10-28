/**
 * Browser-supplied integration tokens.
 *
 * A developer can paste a GitHub/Vercel/Sentry token straight into
 * Settings → Connections. The `/api/integrations/connect` route validates it
 * against the service and returns an AES-GCM sealed token; the browser sends
 * that opaque string with every chat request, and only this module can open it.
 *
 * Server-only.
 */
import { isSealedToken, openJson, sealJson, type SealedEnvelope } from "@/lib/secrets";
import { getIntegration, type IntegrationId } from "./catalog";
import { ATTR_INTEGRATION_TOKENS, HEADER_INTEGRATION_TOKENS } from "./wire";

export { ATTR_INTEGRATION_TOKENS, HEADER_INTEGRATION_TOKENS };

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap so a hostile header cannot force expensive decryption work. */
const MAX_SEALED_TOKENS = 12;

export type SealedIntegrationToken = SealedEnvelope & {
  readonly integrationId: string;
  readonly token: string;
  readonly label?: string;
};

export async function sealIntegrationToken(input: {
  readonly integrationId: IntegrationId;
  readonly token: string;
  readonly label?: string;
}): Promise<{ token: string; expiresAt: number }> {
  return sealJson(
    {
      integrationId: input.integrationId,
      token: input.token,
      label: input.label ?? "Connected in this browser",
    },
    TOKEN_TTL_MS,
  );
}

export async function openIntegrationToken(
  sealed: string | undefined,
): Promise<SealedIntegrationToken | null> {
  return openJson<SealedIntegrationToken>(sealed, (payload) => {
    if (typeof payload.integrationId !== "string") return false;
    if (typeof payload.token !== "string" || payload.token.length === 0) return false;
    return getIntegration(payload.integrationId) !== undefined;
  });
}

/** Reads the sealed tokens out of a request header (unopened). */
export function sealedTokensFromHeader(raw: string | null): readonly string[] {
  if (!raw || raw.length > 16_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => isSealedToken(item)).slice(0, MAX_SEALED_TOKENS);
  } catch {
    return [];
  }
}

/** The session attribute value: a JSON array of sealed tokens. */
export function sealedTokensToAttribute(sealed: readonly string[]): string | undefined {
  return sealed.length > 0 ? JSON.stringify(sealed.slice(0, MAX_SEALED_TOKENS)) : undefined;
}

function readAttribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | null | undefined,
  key: string,
): string | undefined {
  const value = attributes?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/**
 * Opens the caller's sealed tokens and returns the one for this integration.
 * Called from the connection's auth resolver, per tool call.
 */
export async function integrationTokenFor(
  integrationId: string,
  attributes: Readonly<Record<string, string | readonly string[]>> | null | undefined,
): Promise<string | undefined> {
  const raw = readAttribute(attributes, ATTR_INTEGRATION_TOKENS);
  if (!raw) return undefined;
  for (const sealed of sealedTokensFromHeader(raw)) {
    const opened = await openIntegrationToken(sealed);
    if (opened?.integrationId === integrationId) return opened.token;
  }
  return undefined;
}
