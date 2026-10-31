/**
 * Live model discovery + connection checks for OpenAI-compatible providers.
 * Server-only: called from API routes, never from the browser directly.
 */
import type { ModelInfo, ProviderInfo } from "./catalog";
import type { ResolvedCredential } from "./credentials";
import { fetchCatalogResponse, readCatalogJson } from "../catalog-fetch";

const REQUEST_TIMEOUT_MS = 9_000;
const MAX_MODELS = 400;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MODEL_ID = /^[A-Za-z0-9._:/@+\-]{1,180}$/;
const SKIP_MODEL = /(embed|tts|whisper|transcri|moderation|rerank|image|dall-e|sora|guard|safety|audio|speech|vision-preview-ocr)/i;

export type LiveModelsResult = {
  readonly ok: boolean;
  readonly models: readonly ModelInfo[];
  readonly source: "live" | "static";
  readonly latencyMs?: number;
  readonly error?: string;
};

type JsonRecord = Record<string, unknown>;

function modelsURL(provider: ProviderInfo, baseURL: string, apiKey: string): string | null {
  if (!provider.modelsPath) return null;
  const url = new URL(`${baseURL.replace(/\/$/, "")}${provider.modelsPath}`);
  if (provider.kind === "google" && apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

function requestHeaders(provider: ProviderInfo, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    if (provider.kind === "google") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
      if (provider.kind === "anthropic") headers["x-api-key"] = apiKey;
    }
  }
  if (provider.kind === "anthropic") headers["anthropic-version"] = "2023-06-01";
  if (provider.id === "openrouter") {
    if (process.env.APP_URL) headers["HTTP-Referer"] = process.env.APP_URL;
    headers["X-Title"] = "Tflash";
  }
  return { ...headers, ...(provider.modelHeaders ?? {}) };
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOne(provider: ProviderInfo, raw: unknown): ModelInfo | null {
  if (typeof raw === "string") {
    const id = raw.replace(/^models\//, "");
    return MODEL_ID.test(id) && !SKIP_MODEL.test(id) ? { id, name: id } : null;
  }
  const item = asRecord(raw);
  if (!item) return null;
  const id =
    typeof item.id === "string"
      ? item.id
      : typeof item.name === "string"
        ? item.name
        : typeof item.model === "string"
          ? item.model
          : undefined;
  if (!id || SKIP_MODEL.test(id)) return null;
  const cleanId = id.replace(/^models\//, "");
  if (!MODEL_ID.test(cleanId)) return null;
  const name =
    typeof item.display_name === "string"
      ? item.display_name
      : typeof item.displayName === "string"
        ? item.displayName
        : typeof item.name === "string" && item.name !== id
          ? item.name
          : cleanId;
  const pricing = asRecord(item.pricing);
  const inputPrice = pricing ? numberFrom(pricing.prompt) : undefined;
  const outputPrice = pricing ? numberFrom(pricing.completion) : undefined;
  const architecture = asRecord(item.architecture);
  const modality = architecture?.input_modalities;
  const contextWindow =
    numberFrom(item.context_length) ??
    numberFrom(item.contextLength) ??
    numberFrom(item.inputTokenLimit) ??
    numberFrom(item.max_context_length) ??
    (asRecord(item.top_provider) ? numberFrom(asRecord(item.top_provider)!.context_length) : undefined);
  return {
    id: cleanId,
    name: name.slice(0, 200),
    ...(contextWindow && contextWindow >= 4_096 && contextWindow <= 4_000_000 ? { contextWindow: Math.round(contextWindow) } : {}),
    ...(inputPrice !== undefined && inputPrice >= 0 && Number.isFinite(inputPrice * 1_000_000) ? { inputPrice: inputPrice * 1_000_000 } : {}),
    ...(outputPrice !== undefined && outputPrice >= 0 && Number.isFinite(outputPrice * 1_000_000) ? { outputPrice: outputPrice * 1_000_000 } : {}),
    ...(Array.isArray(modality) && modality.includes("image") ? { vision: true } : {}),
    ...(inputPrice === 0 && outputPrice === 0 ? { free: true } : {}),
  };
}

function normalizeList(provider: ProviderInfo, payload: unknown): ModelInfo[] {
  const root = asRecord(payload);
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? (root!.data as unknown[])
      : Array.isArray(root?.models)
        ? (root!.models as unknown[])
        : [];
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const raw of list.slice(0, 20_000)) {
    const model = normalizeOne(provider, raw);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
    if (models.length >= MAX_MODELS) break;
  }
  // Free / cheap models first is a convenient default for an agent UI.
  return models.sort((a, b) => {
    const aPrice = a.inputPrice ?? Number.POSITIVE_INFINITY;
    const bPrice = b.inputPrice ?? Number.POSITIVE_INFINITY;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}

function friendlyError(status: number, provider: ProviderInfo): string {
  if (status === 401 || status === 403) {
    return `${provider.name} rejected the API key (HTTP ${status}). Check the key and try again.`;
  }
  if (status === 404) return `${provider.name} has no /models endpoint at that URL (HTTP 404).`;
  if (status === 429) return `${provider.name} is rate limiting requests (HTTP 429). Try again shortly.`;
  if (status >= 500) return `${provider.name} is unavailable right now (HTTP ${status}).`;
  return `${provider.name} returned HTTP ${status}.`;
}

export async function fetchLiveModels(
  provider: ProviderInfo,
  credential: ResolvedCredential,
): Promise<LiveModelsResult> {
  const started = Date.now();
  if (!provider.modelsPath) {
    return { ok: true, models: [...provider.models], source: "static" };
  }
  const url = modelsURL(provider, credential.baseURL, credential.apiKey);
  if (!url) return { ok: false, models: [...provider.models], source: "static", error: "Invalid endpoint URL." };

  try {
    const { response, signal } = await fetchCatalogResponse(url, {
      headers: requestHeaders(provider, credential.apiKey),
      cache: "no-store",
      // Never forward a credential to a redirect target.
      redirect: "error",
    }, REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => {});
      return {
        ok: false,
        models: [...provider.models],
        source: "static",
        latencyMs: Date.now() - started,
        error: friendlyError(response.status, provider),
      };
    }
    const payload = await readCatalogJson(response, signal, MAX_RESPONSE_BYTES);
    const root = asRecord(payload);
    if (!Array.isArray(payload) && !Array.isArray(root?.data) && !Array.isArray(root?.models)) {
      return { ok: false, models: [...provider.models], source: "static", latencyMs: Date.now() - started, error: `${provider.name} returned an invalid model list. Showing built-in suggestions.` };
    }
    const models = normalizeList(provider, payload);
    return {
      ok: true,
      models: models.length > 0 ? models : [...provider.models],
      source: models.length > 0 ? "live" : "static",
      latencyMs: Date.now() - started,
      ...(models.length ? {} : { error: `${provider.name} returned no usable model IDs. Built-in suggestions are not verified.` }),
    };
  } catch {
    return {
      ok: false,
      models: [...provider.models],
      source: "static",
      latencyMs: Date.now() - started,
      error: `Could not load ${provider.name} models. Showing built-in suggestions.`,
    };
  }
}

export async function testConnection(
  provider: ProviderInfo,
  credential: ResolvedCredential,
): Promise<LiveModelsResult> {
  if (provider.kind === "gateway") {
    return {
      ok: true,
      models: [...provider.models],
      source: "static",
      latencyMs: 0,
    };
  }
  return fetchLiveModels(provider, credential);
}
