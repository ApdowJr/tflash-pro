# T Flash · Ururka Agent

**T Flash** waa goob shaqo AI oo degdeg ah oo ku dhisan [eve](https://eve.dev) + Next.js 16.
Waxaad ku xiri kartaa provider kasta — [OpenRouter](https://openrouter.ai/), OpenAI, Anthropic,
Google Gemini, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio,
ama endpoint kasta oo OpenAI-compatible ah — adigoo furaha gelinaya UI-ga ama environment
variable ahaan. Model-ka waxaa la beddelaa wada hadalka dhexdiisa.

A fast, quiet multi-provider AI workspace built on the eve agent framework.

---

## ✦ Design

T Flash is deliberately plain: warm paper and charcoal surfaces, one accent colour used only
for the logo and small state signals, no gradients, no glass, no decorative icons.

- **Shell** — a persistent sidebar (chat history, search, settings, account) beside a single
  reading column. The sidebar becomes a drawer below `lg`.
- **One reading measure** — conversation and composer share a `max-w-2xl` column, so the eye
  never has to travel.
- **The composer is the hero** — one card, one row of quiet tools (model · style · attach), one
  send button. Everything else is out of the way.
- **Honest states** — thinking, errors, connection status and provider health are written in
  plain language with no fake progress theatre.
- **Brand** — the T Flash mark is a capital **T** whose stem is a lightning bolt, in black and
  amber at every size (favicon → sign-in → sidebar).

Design tokens live in `app/globals.css` (`--brand`, `--brand-tile`, `--brand-bolt`, `--sidebar`,
`--shell-shadow`). The mark itself is `components/brand/logo.tsx`.

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Providers** | 15 built-in providers + custom OpenAI-compatible endpoints. OpenRouter is a first-class citizen. |
| **BYOK** | Paste an API key in **Settings → Providers**. It is validated by a live `/models` call, then sealed with AES-GCM on the server; only an opaque token is kept in the browser. |
| **Server keys** | Set any `*_API_KEY` in the environment for an operator-wide connection. Keys never reach the browser. |
| **Integrations (MCP)** | GitHub, Linear, Notion, Sentry, Supabase, Neon, Vercel, PostHog, Stripe and Resend ship as MCP connections, each with an approval gate matched to its blast radius. Seven of them connect with one OAuth tap in **Settings → Connections**; the rest take a scoped token. See [docs/integrations.md](docs/integrations.md). |
| **Live model catalog** | Models (context length, pricing, vision flags) are fetched from each provider's `/models` endpoint, with a built-in fallback list when offline. |
| **Per-request switching** | The chosen provider/model is sent on every eve request and resolved at runtime with `defineDynamic` + AI SDK `LanguageModel`. No redeploy needed. |
| **Chat** | Streaming messages, reasoning blocks, tool calls, approvals/questions (HITL), attachments, cancellation, steering, resumable `/s/:id` sessions. |
| **Workspace** | Chat history with search, bilingual UI (Soomaali/English), light/dark/system theme, assistant personas via ephemeral `clientContext`, Markdown export, copy buttons, keyboard shortcuts. |
| **Auth** | Better Auth (Vercel social) + `vercelOidc()` + `localDev()`; provider selection is only attached to authenticated principals. |

---

## 🚀 Getting started

```bash
corepack pnpm install          # or: pnpm install
cp .env.example .env.local     # optional — only for server-wide keys / auth
pnpm dev                       # Next.js + eve dev server, http://localhost:3000
```

Node.js **24.x** is required (the eve dev server refuses older runtimes).

Other commands:

```bash
pnpm dev:eve        # eve interactive TUI (chat with the agent in a terminal)
pnpm typecheck      # tsc --noEmit
pnpm build          # production Next.js build (also compiles eve sources)
pnpm build:eve      # compile the eve agent only
pnpm deploy         # deploy to Vercel (eve deploy)
```

Open the app, click the model chip in the top bar (or press **⌘K**), choose a provider, then
open **Settings → Providers** to connect it.

### Connect OpenRouter (example)

1. Create a key at <https://openrouter.ai/keys>.
2. In the app: **Settings → Providers → OpenRouter** → paste key → **Test** → **Connect**.
   The model list refreshes live from `https://openrouter.ai/api/v1/models`.
3. Pick any model in **Models** (⌘K) and start chatting.

Prefer configuration? Add to `.env.local`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Restart the dev server. The provider now shows **Server key** for everyone.

---

## 🧰 Integrations (MCP tools)

Ten developer tools are wired up out of the box. Open **Settings → Connections**
to see which ones are live, what each is allowed to do, and the environment
variable (or Vercel Connect connector) each one needs.

**Click a row, press Continue with GitHub.** You approve on the service's own
consent screen — the row lists exactly what it asks for — and come back
connected. The grant is sealed with AES-256-GCM and kept in this browser only,
renewed in the background when the provider rotates tokens, and dropped the
moment you press **Disconnect**. The model never sees it.

```bash
# operator setup for one-tap connect: register an OAuth app per service
echo "GITHUB_OAUTH_CLIENT_ID=..." >> .env.local
echo "GITHUB_OAUTH_CLIENT_SECRET=..." >> .env.local
# redirect URI: https://your-deployment/api/integrations/oauth/callback

# no OAuth app? Vercel Connect still works, or paste a token per service
vercel connect create github --name t-flash
vercel connect attach <connector-uid> --yes
```

Neon, Stripe and Resend have no third-party OAuth, so those rows ask for a
scoped API key instead — and say why.

Precedence: browser token → Vercel Connect connector → server env var.
Approval tiers: read-only tools run silently, write tools ask once per session,
and money/database/email tools ask on every call. Full guide, including how to
add your own service: [docs/integrations.md](docs/integrations.md).

---

## 🔌 How provider routing works

```
Browser (model picker)                 Server (eve)
──────────────────────                ──────────────────────────────────────
x-tflash-provider: openrouter   ──▶   agent/channels/eve.ts
x-tflash-model:    openai/...         authenticates, validates against the
x-tflash-context:  128000             allowlisted catalog, stores the choice
x-tflash-token:    v1.<sealed>        in session auth attributes
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

## 📁 Project layout

```
agent/
  agent.ts                    dynamic per-request model selection
  channels/eve.ts             auth + provider headers → session attributes
  connections/*.ts            one-liner MCP connections driven by lib/integrations
  instructions.md             agent identity (Somali/English aware)
app/
  layout.tsx                  metadata, theme bootstrap, providers
  page.tsx, s/…               chat entry points
  globals.css                 design tokens (T Flash palette)
  icon.svg, apple-icon.tsx    brand mark as app icons
components/
  brand/logo.tsx              T Flash mark + lockup
  chat/                       agent-chat, composer, messages, auth wrapper
  workspace/                  sidebar, top-bar, empty state
  settings/                   app settings, i18n, personas, providers, model browser
  ai-elements/, ui/           generated primitives (message, prompt input, dialogs…)
lib/
  chat-history.ts             grouping/search for the sidebar
  integrations/               catalog, OAuth authorizer, Connect/token resolution
  providers/                  catalog, selection contract, credentials, runtime, live models
docs/
  integrations.md             MCP setup, approval tiers, adding a service
```

---

## 🧰 Stack

Next.js 16 · React 19 · Tailwind CSS 4 · shadcn/Radix UI · AI Elements · eve 0.83 ·
AI SDK 7 · Better Auth · Zod · TypeScript 6 · Vercel AI Gateway.
