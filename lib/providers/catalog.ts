/**
 * Shared, secret-free provider catalog.
 *
 * This module is imported by server code (agent + API routes) AND by client
 * components, so it must never read `process.env` or contain credentials.
 */

export type ProviderKind =
  | "gateway"
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible";

export type ModelInfo = {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  /** USD per 1M input tokens, when the provider publishes pricing. */
  readonly inputPrice?: number;
  /** USD per 1M output tokens, when the provider publishes pricing. */
  readonly outputPrice?: number;
  readonly vision?: boolean;
  readonly free?: boolean;
};

export type ProviderInfo = {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly kind: ProviderKind;
  /** Chat API base URL (OpenAI-compatible `/chat/completions` is appended by the SDK). */
  readonly baseURL: string;
  /** Path used to discover models. `null` means the provider has no list endpoint. */
  readonly modelsPath: string | null;
  /** Server environment variable that holds an operator-wide API key. */
  readonly envKey?: string;
  /** Where a user can create an API key. */
  readonly keyUrl: string;
  readonly docsUrl: string;
  readonly defaultModel: string;
  readonly contextWindow: number;
  readonly models: readonly ModelInfo[];
  readonly requiresKey: boolean;
  /** Allows a user-supplied base URL (self-hosted / custom gateways). */
  readonly customBaseURL?: boolean;
  /** Extra headers needed when listing models (never secret). */
  readonly modelHeaders?: Readonly<Record<string, string>>;
  /** The model catalog is public even though chat calls need a key. */
  readonly publicModels?: boolean;
  /** Tailwind-friendly accent color used by the UI. */
  readonly accent: string;
  readonly short: string;
  readonly featured?: boolean;
  readonly group: "gateway" | "cloud" | "local";
};

export const DEFAULT_PROVIDER_ID = "gateway";
export const DEFAULT_GATEWAY_MODEL = "nvidia/nemotron-3.5-lightning-free";
export const DEFAULT_CONTEXT_WINDOW = 128_000;

const m = (
  id: string,
  name?: string,
  contextWindow?: number,
  extra?: Partial<ModelInfo>,
): ModelInfo => ({ id, name: name ?? id, contextWindow, ...extra });

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Hal furaha, boqolaal model / One key, hundreds of models",
    kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    modelsPath: "/models",
    envKey: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs/quick-start",
    defaultModel: "openai/gpt-4o-mini",
    contextWindow: 128_000,
    requiresKey: true,
    accent: "#6366f1",
    short: "OR",
    featured: true,
    publicModels: true,
    group: "cloud",
    models: [
      m("openai/gpt-4o-mini", "OpenAI GPT-4o mini", 128_000),
      m("openai/gpt-4o", "OpenAI GPT-4o", 128_000, { vision: true }),
      m("anthropic/claude-3.5-sonnet", "Anthropic Claude 3.5 Sonnet", 200_000, {
        vision: true,
      }),
      m("google/gemini-2.0-flash-001", "Google Gemini 2.0 Flash", 1_000_000, {
        vision: true,
      }),
      m("meta-llama/llama-3.3-70b-instruct", "Meta Llama 3.3 70B", 131_072),
      m("deepseek/deepseek-chat", "DeepSeek V3", 64_000),
      m("mistralai/mistral-nemo", "Mistral Nemo", 128_000),
      m("qwen/qwen-2.5-72b-instruct", "Qwen 2.5 72B", 131_072),
    ],
  },
  {
    id: "gateway",
    name: "Vercel AI Gateway",
    tagline: "Defaultka mashruuca / Project default (no key needed on Vercel)",
    kind: "gateway",
    baseURL: "https://ai-gateway.vercel.sh/v1",
    modelsPath: null,
    keyUrl: "https://vercel.com/docs/ai-gateway",
    docsUrl: "https://vercel.com/docs/ai-gateway/models",
    defaultModel: DEFAULT_GATEWAY_MODEL,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    requiresKey: false,
    accent: "#0f172a",
    short: "AI",
    featured: true,
    group: "gateway",
    models: [
      m(DEFAULT_GATEWAY_MODEL, "NVIDIA Nemotron 3.5 Lightning (free)", 128_000, {
        free: true,
      }),
      m("anthropic/claude-sonnet-5", "Claude Sonnet 5", 200_000),
      m("openai/gpt-6-luna-fast", "GPT-6 Luna Fast", 128_000),
      m("google/gemini-3.5-flash", "Gemini 3.5 Flash", 1_000_000, {
        vision: true,
      }),
      m("zai/glm-5.2", "Z.ai GLM 5.2", 200_000),
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT models, toos ah / direct",
    kind: "openai",
    baseURL: "https://api.openai.com/v1",
    modelsPath: "/models",
    envKey: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs/models",
    defaultModel: "gpt-4o-mini",
    contextWindow: 128_000,
    requiresKey: true,
    accent: "#10a37f",
    short: "OA",
    group: "cloud",
    models: [
      m("gpt-4o-mini", "GPT-4o mini", 128_000, { vision: true }),
      m("gpt-4o", "GPT-4o", 128_000, { vision: true }),
      m("o4-mini", "o4-mini (reasoning)", 200_000),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    tagline: "Claude models, toos ah / direct",
    kind: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    modelsPath: "/models",
    envKey: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    defaultModel: "claude-sonnet-4-5",
    contextWindow: 200_000,
    requiresKey: true,
    accent: "#d97757",
    short: "AN",
    group: "cloud",
    modelHeaders: { "anthropic-version": "2023-06-01" },
    models: [
      m("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, { vision: true }),
      m("claude-3-5-haiku-latest", "Claude 3.5 Haiku", 200_000, { vision: true }),
      m("claude-opus-4-1", "Claude Opus 4.1", 200_000, { vision: true }),
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    tagline: "Gemini models, toos ah / direct",
    kind: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    modelsPath: "/models",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    keyUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    defaultModel: "gemini-2.5-flash",
    contextWindow: 1_000_000,
    requiresKey: true,
    accent: "#4285f4",
    short: "GE",
    group: "cloud",
    models: [
      m("gemini-2.5-flash", "Gemini 2.5 Flash", 1_000_000, { vision: true }),
      m("gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000, { vision: true }),
      m("gemini-2.0-flash", "Gemini 2.0 Flash", 1_000_000, { vision: true }),
    ],
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Jawaab aad u dheereysa / ultra-fast inference",
    kind: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    modelsPath: "/models",
    envKey: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs/models",
    defaultModel: "llama-3.3-70b-versatile",
    contextWindow: 131_072,
    requiresKey: true,
    accent: "#f55036",
    short: "GQ",
    group: "cloud",
    models: [
      m("llama-3.3-70b-versatile", "Llama 3.3 70B", 131_072),
      m("llama-3.1-8b-instant", "Llama 3.1 8B Instant", 131_072),
      m("openai/gpt-oss-120b", "GPT-OSS 120B", 131_072),
    ],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    tagline: "Models Yurub laga dhisay / European models",
    kind: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    modelsPath: "/models",
    envKey: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai/getting-started/models/models_overview/",
    defaultModel: "mistral-small-latest",
    contextWindow: 128_000,
    requiresKey: true,
    accent: "#ff7000",
    short: "MI",
    group: "cloud",
    models: [
      m("mistral-small-latest", "Mistral Small", 128_000),
      m("mistral-large-latest", "Mistral Large", 128_000),
      m("codestral-latest", "Codestral", 256_000),
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    tagline: "Reasoning qiimo jaban / low-cost reasoning",
    kind: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    modelsPath: "/models",
    envKey: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/",
    defaultModel: "deepseek-chat",
    contextWindow: 64_000,
    requiresKey: true,
    accent: "#4d6bfe",
    short: "DS",
    group: "cloud",
    models: [
      m("deepseek-chat", "DeepSeek V3 (chat)", 64_000),
      m("deepseek-reasoner", "DeepSeek R1 (reasoning)", 64_000),
    ],
  },
  {
    id: "xai",
    name: "xAI",
    tagline: "Grok models",
    kind: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    modelsPath: "/models",
    envKey: "XAI_API_KEY",
    keyUrl: "https://console.x.ai/",
    docsUrl: "https://docs.x.ai/docs/models",
    defaultModel: "grok-3-mini",
    contextWindow: 131_072,
    requiresKey: true,
    accent: "#111827",
    short: "XA",
    group: "cloud",
    models: [
      m("grok-3-mini", "Grok 3 Mini", 131_072),
      m("grok-3", "Grok 3", 131_072),
    ],
  },
  {
    id: "together",
    name: "Together AI",
    tagline: "Open-weight models la marti galiyay / hosted open models",
    kind: "openai-compatible",
    baseURL: "https://api.together.xyz/v1",
    modelsPath: "/models",
    envKey: "TOGETHER_API_KEY",
    keyUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai/docs/inference-models",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    contextWindow: 131_072,
    requiresKey: true,
    accent: "#8b5cf6",
    short: "TG",
    group: "cloud",
    models: [
      m("meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B Turbo", 131_072),
      m("Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen 2.5 72B Turbo", 131_072),
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    tagline: "Open models, latency yar / low-latency open models",
    kind: "openai-compatible",
    baseURL: "https://api.fireworks.ai/inference/v1",
    modelsPath: "/models",
    envKey: "FIREWORKS_API_KEY",
    keyUrl: "https://fireworks.ai/account/api-keys",
    docsUrl: "https://docs.fireworks.ai/getting-started/quickstart",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    contextWindow: 131_072,
    requiresKey: true,
    accent: "#f59e0b",
    short: "FW",
    group: "cloud",
    models: [
      m("accounts/fireworks/models/llama-v3p3-70b-instruct", "Llama 3.3 70B", 131_072),
      m("accounts/fireworks/models/qwen2p5-72b-instruct", "Qwen 2.5 72B", 131_072),
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    tagline: "Wafer-scale, aad u dhakhso badan / extremely fast",
    kind: "openai-compatible",
    baseURL: "https://api.cerebras.ai/v1",
    modelsPath: "/models",
    envKey: "CEREBRAS_API_KEY",
    keyUrl: "https://cloud.cerebras.ai/platform/apikeys",
    docsUrl: "https://inference-docs.cerebras.ai/models/overview",
    defaultModel: "llama-3.3-70b",
    contextWindow: 131_072,
    requiresKey: true,
    accent: "#ef4444",
    short: "CB",
    group: "cloud",
    models: [
      m("llama-3.3-70b", "Llama 3.3 70B", 131_072),
      m("qwen-3-32b", "Qwen 3 32B", 131_072),
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Local, kombuyuutarkaaga / runs on your machine",
    kind: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    modelsPath: "/models",
    keyUrl: "https://docs.ollama.com/api/openai-compatibility",
    docsUrl: "https://docs.ollama.com/api/openai-compatibility",
    defaultModel: "llama3.2",
    contextWindow: 65_536,
    requiresKey: false,
    customBaseURL: true,
    accent: "#0ea5e9",
    short: "OL",
    group: "local",
    models: [
      m("llama3.2", "Llama 3.2", 131_072),
      m("qwen3", "Qwen 3", 131_072),
      m("gpt-oss:20b", "GPT-OSS 20B", 131_072),
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    tagline: "Local server, OpenAI-compatible",
    kind: "openai-compatible",
    baseURL: "http://localhost:1234/v1",
    modelsPath: "/models",
    keyUrl: "https://lmstudio.ai/docs/app/api/endpoints/openai",
    docsUrl: "https://lmstudio.ai/docs/app/api/endpoints/openai",
    defaultModel: "local-model",
    contextWindow: 65_536,
    requiresKey: false,
    customBaseURL: true,
    accent: "#7c3aed",
    short: "LM",
    group: "local",
    models: [m("local-model", "Loaded model", 65_536)],
  },
  {
    id: "custom",
    name: "Custom endpoint",
    tagline: "Wax kasta oo OpenAI-compatible / any OpenAI-compatible API",
    kind: "openai-compatible",
    baseURL: "https://your-endpoint.example/v1",
    modelsPath: "/models",
    envKey: "CUSTOM_PROVIDER_API_KEY",
    keyUrl: "https://platform.openai.com/docs/api-reference/chat",
    docsUrl: "https://ai-sdk.dev/providers/openai-compatible-providers",
    defaultModel: "gpt-4o-mini",
    contextWindow: 128_000,
    requiresKey: false,
    customBaseURL: true,
    accent: "#64748b",
    short: "CU",
    group: "local",
    models: [m("gpt-4o-mini", "Default model id", 128_000)],
  },
];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProvider(id: string | undefined | null): ProviderInfo | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function defaultProvider(): ProviderInfo {
  return BY_ID.get(DEFAULT_PROVIDER_ID) ?? PROVIDERS[0]!;
}

export function findModel(provider: ProviderInfo, modelId: string): ModelInfo | undefined {
  return provider.models.find((model) => model.id === modelId);
}

export function formatContext(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

export function formatPrice(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === 0) return "free";
  if (value < 0.1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
