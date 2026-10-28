# Tflash

Tflash waa goob wada hadal AI ah oo ku hadasha Soomaali iyo English. Waxaad ku geli kartaa akoonkaaga, waxaadna dooran kartaa OpenRouter, OpenAI, Anthropic, Gemini, ama provider kale oo aad ku kalsoon tahay.

Tflash is an Eve + Next.js workspace with email/password accounts, account-isolated conversation history, streaming chat, and per-turn model selection.

## What is included

- A responsive Tflash identity, sign-in, sign-up, email confirmation, and password recovery.
- Supabase Auth and an RLS-protected conversation index. Eve session routes additionally check a server-signed user/session binding, including streams and controls.
- OpenRouter and 14 other provider choices, including Vercel AI Gateway, OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio, and a custom OpenAI-compatible endpoint.
- Live model discovery with a built-in fallback catalog, provider connections, streaming messages, attachments, Markdown export, themes, keyboard shortcuts, and Somali/English UI.

## Run locally

Use **Node.js 24** and pnpm via Corepack. The package manager version is pinned in `package.json`; Vercel's install command and the CI workflow use the same frozen lockfile:

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
# Add stable local secrets to .env.local (see below).
corepack pnpm dev
```

Open <http://localhost:3000>. The sample public Supabase URL and publishable key point to the Tflash project; they may be replaced with another project's public values. `NEXT_PUBLIC_*` values are embedded at build time, so set them before building. Do not use a Supabase service-role or secret key in client-side variables.

Generate **two independent secrets** locally, for example by running the following twice and putting the results in `.env.local` as `TFLASH_SESSION_SECRET` and `PROVIDER_KEYS_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Both should be at least 32 characters, private, and stable across all Next and Eve instances. Development has deliberately insecure fallback values if they are missing; production does not. If only one of the two is supplied, it is used as the fallback for the other. Changing the session secret invalidates existing ownership proofs, making indexed chats inaccessible; changing the provider secret invalidates saved provider connections.

Useful commands:

```bash
corepack pnpm test          # unit and local mock integration tests (no credentials)
corepack pnpm typecheck
corepack pnpm build         # Next production build, including type checks
corepack pnpm build:eve     # Eve agent build
```

`.github/workflows/ci.yml` runs these checks with dummy credentials on pushes and pull requests. Its mock tests do not validate live Supabase, provider, or Vercel connectivity.

## Supabase setup

The Tflash project already has the migration in `supabase/migrations/20261028000000_create_tflash_chats.sql`. For a different project, apply that migration once using the Supabase SQL Editor or your migration workflow. It creates the chat index, grants authenticated access, and enables user-specific RLS policies. Eve transcripts are stored by Eve's workflow world, not in this table.

1. Enable **Email** authentication and configure the confirmation policy under Supabase Auth. This app supports email/password; social sign-in is not configured.
2. In **Auth → URL Configuration**, set the **Site URL** to your real production origin and allow each deployment callback (including its query string), for example `http://localhost:3000/auth/callback**` and `https://your-domain.example/auth/callback**`. Add the specific preview host separately when testing a preview; avoid a wildcard over hosts you do not control. An unlisted callback cannot complete sign-up or password recovery.
3. The current project has email confirmation enabled. A user must open the confirmation link before signing in; finish a PKCE email flow in the browser that initiated it. Configure a production SMTP provider and appropriate rate limits before inviting a wider audience; the default email service is restricted.
4. Set the public URL/key and both secrets in your hosting environment. Configure `APP_URL` as the public HTTPS origin. If internal Eve traffic uses a different trusted origin, set `TFLASH_INTERNAL_ORIGIN`; otherwise Vercel's deployment URL or `APP_URL` is used. Production internal origins must use HTTPS and must route `/eve/` to this app. Never derive the internal destination from an incoming Host header. For a deployment protected by Vercel Authentication, enable [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) and select a secret for the `VERCEL_AUTOMATION_BYPASS_SECRET` system environment variable. The app uses it only on server-side Next-to-Eve calls; never expose it to browsers. Redeploy after changing or rotating the secret.

The index stores a title and session ID per account. A conversation is listed only after its first message has been titled. Deleting it removes the index entry and attempts to reset the Eve session; the app then denies ordinary access while that entry is absent. It is **not a guaranteed immediate erasure** of workflow events or sandbox files: configure retention and deletion for your Eve workflow world and sandbox separately. A signed-in owner has database access to their own index rows, so do not treat removal from the UI as cryptographic destruction of the underlying transcript.

## Connect a provider

For OpenRouter:

1. Create a key at <https://openrouter.ai/keys>.
2. Open **Providers → OpenRouter**, paste the key, test the connection, and connect.
3. Open **Models**, choose a model, and send a message. You can change providers and models on subsequent turns.

Alternatively set `OPENROUTER_API_KEY` on the server for an operator-wide connection. Other supported `*_API_KEY` variables are listed in `.env.example`. The provider/model headers are validated and resolved to the corresponding AI SDK model on the server; the UI does not just change the label. Operator-wide keys incur the operator's costs for any user who can access them. Before a public launch, add appropriate rate limits, quotas, monitoring, and abuse controls at your hosting edge.

Browser-supplied keys are sealed with AES-GCM on the server. The browser keeps an opaque token in account-scoped local storage; it expires after seven days and is removed on sign-out or when clearing local provider keys. It is still a bearer credential: anyone who obtains the token can use it until expiry, and clearing it locally does not revoke the underlying provider key. Rotate the provider key if it was exposed. Server-wide provider keys are never intentionally returned to the browser.

### Custom and local endpoints

Custom, Ollama, and LM Studio base URLs are called **from the server**, not the user's browser. A deployed app cannot use a model on the user's laptop via `localhost`. In production, an operator must list each trusted exact `host[:port]` in `CUSTOM_PROVIDER_ALLOWED_HOSTS`, including the default local hosts if they are intended. An empty list denies customizable hosts. HTTPS is required except for an explicitly allowlisted loopback HTTP endpoint; credentials in URLs and metadata/internal hostnames are rejected. Requests to custom model endpoints and model discovery do not follow redirects. Only allow hosts and DNS you control and trust.

## Tool safety

Shell commands and every tool exposed by the Supabase, Vercel, and Resend MCP connections require a fresh in-chat approval before they run. Review the displayed parameters before approving. The MCP connections are user-scoped and require their own Vercel Connect setup; provider selection is separate and does not require these integrations. Local Eve self-modification is disabled so a chat user cannot edit the app's source through that development extension.

New production shell sandboxes use a deny-all network policy; provider requests and Eve's web tools run outside that shell sandbox. Local just-bash cannot enforce network isolation and is explicitly allowed network access during development. Existing sandboxes created before a policy change may keep their old policy until replaced. Other Eve tools can still access sandbox files or the network. Approvals are not a substitute for sandbox isolation, scoped credentials, monitoring, or a review of all enabled capabilities before public use.

## Deployment and storage

Eve needs a sandbox provider even for a chat turn. Local development can use the installed `just-bash` fallback when Docker is unavailable; it runs in the application process and does **not** provide network isolation. Production builds do not fall back to it: build on Vercel with Vercel Sandbox available, or build with a reachable Docker daemon / an explicitly configured production sandbox provider. A successful build without a provider is not proof that turns can run. Review Eve's sandbox security documentation before exposing tools to untrusted users.

On self-hosted installations, persist Eve's workflow storage (`.eve/.workflow-data` with the default local world) and use a workflow world appropriate to your scaling and retention needs. Preserve both `/eve/` and `/.well-known/workflow/` routes through a reverse proxy. Supabase stores only the conversation index; losing the workflow store loses the associated transcripts even if titles remain. See the Eve deployment and sandbox docs in `node_modules/eve/docs` for the hosting topology and limitations.

## Key files

- `components/app/auth-screen.tsx`, `brand.tsx`, `workspace-shell.tsx` — account screens, identity, and workspace.
- `lib/supabase/*`, `proxy.ts`, `app/auth/*` — Supabase clients, refresh, and callbacks.
- `app/api/chats/*`, `lib/security/*`, `agent/channels/eve.ts` — conversation ownership and authenticated Eve routes.
- `lib/providers/*`, `app/api/providers/*`, `agent/agent.ts` — provider credentials, discovery, and dynamic model routing.
- `components/app/settings-provider.tsx`, `app/_components/agent-chat.tsx` — account-scoped settings, history, and chat UI.
