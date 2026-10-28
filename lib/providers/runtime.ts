/**
 * Turns a validated wire selection into a concrete AI SDK language model for
 * eve's dynamic model resolver. Server-only.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getProvider } from "./catalog";
import { resolveCredential } from "./credentials";
import type { WireSelection } from "./selection";

export type ResolvedModel = {
  readonly model: LanguageModel | string;
  readonly contextWindow: number;
};

export async function resolveLanguageModel(selection: WireSelection): Promise<ResolvedModel> {
  const provider = getProvider(selection.providerId);
  if (!provider || provider.kind === "gateway") {
    return { model: selection.modelId, contextWindow: selection.contextWindow };
  }

  const credential = await resolveCredential(provider, selection.token);
  const apiKey = credential.apiKey || undefined;
  const baseURL = credential.baseURL;
  const modelId = selection.modelId;

  const providerHeaders: Record<string, string> =
    provider.id === "openrouter"
      ? {
          ...(process.env.APP_URL ? { "HTTP-Referer": process.env.APP_URL } : {}),
          "X-Title": "Tflash",
        }
      : {};

  let model: LanguageModel;
  switch (provider.kind) {
    case "openai":
      model = createOpenAI({ apiKey, baseURL })(modelId);
      break;
    case "anthropic":
      model = createAnthropic({ apiKey, baseURL })(modelId);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
      break;
    default:
      model = createOpenAICompatible({
        name: provider.id,
        baseURL,
        apiKey,
        headers: providerHeaders,
        // A custom host may not redirect server requests to an unapproved host.
        ...(provider.customBaseURL
          ? { fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) }
          : {}),
        // Ask OpenAI-compatible servers to report token usage while streaming.
        includeUsage: true,
      })(modelId);
      break;
  }

  return { model, contextWindow: selection.contextWindow };
}
