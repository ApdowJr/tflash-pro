# Ururka Agent / وکیل • Soomaali

**Ururka Agent** waa chat-app casri ah oo ku dhisan [eve](https://eve.dev) + Next.js 16.
Waxa ugu weyn ee lagu daray: **waxaad ku xiri kartaa provider kasta** — [OpenRouter](https://openrouter.ai/),
OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, xAI, Together, Fireworks,
Cerebras, Ollama, LM Studio, ama endpoint kasta oo OpenAI-compatible ah — adigoo furaha
gelinaya UI-ga ama environment variable ahaan. Model-ka waxaa la beddelaa wada hadalka dhexdiisa.

A modern, multi-provider AI workspace built with the eve agent framework.

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Providers** | 15 built-in providers + custom OpenAI-compatible endpoints. OpenRouter is a first-class citizen. |
| **BYOK** | Paste an API key in **Settings → Providers**. It is validated by a live `/models` call, then sealed with AES-GCM on the server; only an opaque token is kept in the browser. |
| **Server keys** | Set any `*_API_KEY` in the environment for an operator-wide connection. Keys never reach the browser. |
| **Live model catalog** | Models (with context length, pricing, vision flags) are fetched from each provider's `/models` endpoint, with a built-in fallback list when offline. |
| **Per-request switching** | The chosen provider/model is sent on every eve request and resolved at runtime with `defineDynamic` + AI SDK `LanguageModel`. No redeploy needed. |
| **Chat UI** | Streaming messages, reasoning blocks, tool calls, approvals/questions (HITL), file attachments, cancellation, steering, resumable `/s/:id` sessions. |
| **Modern extras** | Searchable model picker (⌘K), bilingual UI (Soomaali/English), light/dark/system theme, assistant personas via ephemeral `clientContext`, local chat history, Markdown export, copy buttons, keyboard shortcuts. |
| **Auth** | Better Auth (Vercel social) + `vercelOidc()` + `localDev()`; provider selection is only attached to authenticated principals. |

---

## 🚀 Getting started

```bash
corepack pnpm install          # or: pnpm install
cp .env.example .env.local     # optional — only for server-wide keys / auth
pnpm dev                      # Next.js + eve dev server, http://localhost:3000
```

Other commands:

```bash
pnpm dev:eve        # eve interactive TUI (chat with the agent in a terminal)
pnpm typecheck      # tsc --noEmit
pnpm build          # production Next.js build (also compiles eve sources)
pnpm build:eve      # compile the eve agent only
pnpm deploy         # deploy to Vercel (eve deploy)
```

Open the app, click the model chip (or press **⌘K**), choose a provider, then open
**Settings → Providers** to connect it.

### Connect OpenRouter (example)

1. Create a key at <https://openrouter.ai/keys>.
2. In the app: **Settings → Providers → OpenRouter** → paste key → **Test** → **Connect**.
   The model list refreshes live from `https://openrouter.ai/api/v1/models`.
3. Pick any model in **Models** (⌘K) and start chatting.

Prefer configuration instead? Add to `.env.local`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Restart the dev server. The provider now shows **Server key** for everyone.

---

## 🔌 How provider routing works

```
Browser (model picker)                 Server (eve)
──────────────────────                ──────────────────────────────────────
x-ururka-provider: openrouter   ──▶   agent/channels/eve.ts
x-ururka-model:    openai/...         authenticates, validates against the
x-ururka-context:  128000             allowlisted catalog, stores the choice
x-ururka-token:    v1.<sealed>        in session auth attributes
                                             │
                                             ▼
                                      agent/agent.ts  (defineDynamic)
                                      session.started → Gateway model id (serializable)
                                      step.started    → live AI SDK LanguageModel
                                             │
                                             ▼
                                      lib/providers/runtime.ts
                                      createOpenAICompatible / createOpenAI /
                                      createAnthropic / createGoogleGenerativeAI
```

- `session.started` must return a **string** (eve serializes it); `step.started` may return
  a live provider object. Both pass an explicit `modelContextWindowTokens`, so no AI Gateway
  metadata lookup is needed for direct providers.
- Direct providers use their real SDKs; everything else uses
  `@ai-sdk/openai-compatible` with `includeUsage: true`.
- The browser never receives a plaintext server key. Browser keys are encrypted with
  `PROVIDER_KEYS_SECRET` (fallback `BETTER_AUTH_SECRET`) and expire after 7 days.

### Adding another provider

Add one entry to `lib/providers/catalog.ts` (id, name, `baseURL`, `modelsPath`, `envKey`,
default model, fallback models). That is enough — the UI, API routes, validation, and
runtime model factory all read from that catalog.

### Custom endpoints

Choose **Custom endpoint**, **Ollama**, or **LM Studio** in Settings and set a base URL.
Only `https://` URLs (plus `http://localhost` in development) are accepted; credentials in
URLs and cloud metadata addresses are rejected. Note that a deployed server cannot reach a
model running on your laptop — use a tunnel or a hosted endpoint in production.

---

## 🔐 Security notes

- Browser tokens are AES-GCM encrypted but stateless: anyone holding one can use that
  connection until it expires. Use short-lived keys, rotate them, and click **Disconnect**
  on shared machines.
- The provider/model headers are validated against the server catalog; invalid values fall
  back to the default Gateway model. Only authenticated callers get selection attributes.
- Production requires `BETTER_AUTH_SECRET`, `VERCEL_APP_CLIENT_ID`, and
  `VERCEL_APP_CLIENT_SECRET`; see `lib/auth.ts`.
- Review eve's [responsible use](https://eve.dev/docs) notes before exposing the agent to
  sensitive data: tools, MCP connections, and sandboxes have their own permission model.

---

## 📁 Key files

```
agent/agent.ts                  dynamic per-request model selection
agent/channels/eve.ts           auth + provider headers → session attributes
agent/instructions.md           agent identity (Somali/English aware)
lib/providers/catalog.ts        provider + fallback model registry
lib/providers/selection.ts      header/attribute validation contract
lib/providers/credentials.ts    AES-GCM sealing + env key resolution
lib/providers/live-models.ts    /models discovery and connection tests
lib/providers/runtime.ts        AI SDK LanguageModel factory
app/api/providers/*             status, models, test, connect routes
components/app/*                settings, model browser, header, empty state, i18n
app/_components/agent-chat.tsx  chat shell and eve hook wiring
```

---

## 🧰 Stack

Next.js 16 · React 19 · Tailwind CSS 4 · shadcn/Radix UI · AI Elements · eve 0.83 ·
AI SDK 7 · Better Auth · Zod · TypeScript 6 · Vercel AI Gateway.
