/**
 * Wire contract between the browser chat UI, the eve channel, and the agent's
 * dynamic model resolver. Everything here is public metadata: credentials are
 * only ever carried as an opaque, encrypted token (see `credentials.ts`).
 */
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_GATEWAY_MODEL,
  DEFAULT_PROVIDER_ID,
  defaultProvider,
  getProvider,
} from "./catalog";

export const HEADER_PROVIDER = "x-ururka-provider";
export const HEADER_MODEL = "x-ururka-model";
export const HEADER_CONTEXT = "x-ururka-context";
export const HEADER_TOKEN = "x-ururka-token";

export const ATTR_PROVIDER = "ururka:provider";
export const ATTR_MODEL = "ururka:model";
export const ATTR_CONTEXT = "ururka:context";
export const ATTR_TOKEN = "ururka:token";

export const MIN_CONTEXT_WINDOW = 4_096;
export const MAX_CONTEXT_WINDOW = 4_000_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@+\-]{1,180}$/;

export type WireSelection = {
  readonly providerId: string;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly token?: string;
};

export type RawSelection = {
  readonly providerId?: unknown;
  readonly modelId?: unknown;
  readonly contextWindow?: unknown;
  readonly token?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function clampContext(value: unknown, fallback = DEFAULT_CONTEXT_WINDOW): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_CONTEXT_WINDOW, Math.max(MIN_CONTEXT_WINDOW, Math.round(parsed)));
}

/** Validates untrusted input against the allowlisted catalog. */
export function sanitizeSelection(raw: RawSelection): WireSelection {
  const providerId = asString(raw.providerId) ?? DEFAULT_PROVIDER_ID;
  const provider = getProvider(providerId) ?? defaultProvider();
  const requestedModel = asString(raw.modelId);
  const modelId =
    requestedModel && MODEL_ID_PATTERN.test(requestedModel)
      ? requestedModel
      : provider.defaultModel;
  const token = asString(raw.token);
  return {
    providerId: provider.id,
    modelId,
    contextWindow: clampContext(raw.contextWindow, provider.contextWindow),
    // A sealed token is validated cryptographically before it is ever used.
    ...(token && token.length <= 4096 && token.startsWith("v1.") ? { token } : {}),
  };
}

export function selectionFromHeaders(headers: Headers): WireSelection {
  return sanitizeSelection({
    providerId: headers.get(HEADER_PROVIDER),
    modelId: headers.get(HEADER_MODEL),
    contextWindow: headers.get(HEADER_CONTEXT),
    token: headers.get(HEADER_TOKEN),
  });
}

export function selectionToHeaders(selection: WireSelection): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADER_PROVIDER]: selection.providerId,
    [HEADER_MODEL]: selection.modelId,
    [HEADER_CONTEXT]: String(selection.contextWindow),
  };
  if (selection.token) headers[HEADER_TOKEN] = selection.token;
  return headers;
}

/** Auth attributes are strings, so the channel stores the already-sanitized values. */
export function selectionToAttributes(
  selection: WireSelection,
): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {
    [ATTR_PROVIDER]: selection.providerId,
    [ATTR_MODEL]: selection.modelId,
    [ATTR_CONTEXT]: String(selection.contextWindow),
  };
  if (selection.token) attributes[ATTR_TOKEN] = selection.token;
  return attributes;
}

export type SessionAttributes = Readonly<Record<string, string | readonly string[]>> | null | undefined;

function readAttribute(attributes: SessionAttributes, key: string): string | undefined {
  const value = attributes?.[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export function selectionFromAttributes(attributes: SessionAttributes): WireSelection {
  return sanitizeSelection({
    providerId: readAttribute(attributes, ATTR_PROVIDER),
    modelId: readAttribute(attributes, ATTR_MODEL),
    contextWindow: readAttribute(attributes, ATTR_CONTEXT),
    token: readAttribute(attributes, ATTR_TOKEN),
  });
}

export function gatewayFallbackModel(selection: WireSelection): string {
  return selection.providerId === DEFAULT_PROVIDER_ID
    ? selection.modelId
    : DEFAULT_GATEWAY_MODEL;
}
