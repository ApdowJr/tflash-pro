# Tflash

Tflash waa goob wada hadal AI ah oo ku hadasha Soomaali iyo English. Ku gal email iyo furahaaga ama Vercel, dabadeed dooro OpenRouter, OpenAI, Anthropic, Gemini, ama provider kale.

Tflash is an Eve + Next.js workspace with streaming chat, per-turn model selection, two sign-in methods, and ten approval-gated MCP connections.

## Get started

Use **Node.js 24** and the pinned pnpm version through Corepack:

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env.local
# Set local secrets and, if desired, Vercel login credentials.
corepack pnpm dev
```

Open <http://localhost:3000>. The example Supabase URL and publishable key are public; `NEXT_PUBLIC_*` variables are embedded at build time. Never put a Supabase service-role key or other secret in a public variable.

Generate two independent random values and keep them private and stable across all Next and Eve instances:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set `TFLASH_SESSION_SECRET` (chat ownership proofs) and `PROVIDER_KEYS_SECRET` (provider/integration credential encryption) to values of at least 32 characters. If only one is set, it is the fallback for the other; separate values are recommended. Development-only fallback values are insecure, and production rejects missing or short secrets. Rotating the session secret invalidates existing chat proofs; rotating the credential secret invalidates saved connections and in-flight OAuth flows.

For a **Git preview only**, `TFLASH_PREVIEW_USE_AUTH_SECRET=1` explicitly permits deriving separate, branch-specific preview keys from a sufficiently long `BETTER_AUTH_SECRET`. The branch name must be present in `VERCEL_GIT_COMMIT_REF`. This never applies to production. Changing the branch, root secret, or flag invalidates the preview's existing proofs and connections. Prefer dedicated secrets when preview data must persist independently.

```bash
corepack pnpm test        # local unit and mock-service tests
corepack pnpm typecheck
corepack pnpm build       # Next production build
corepack pnpm build:eve   # Eve agent build
```

CI runs these checks using dummy values. Passing them does not establish live Supabase, model-provider, OAuth, or sandbox connectivity. `/api/health` reports configuration without values; its `ready` flag checks required signing/encryption keys, not live services.

## Accounts and history

- **Supabase email/password:** sign-up sends an email confirmation code, then returns the user to password sign-in. Password recovery still uses a link. The `tflash_chats` index uses RLS and server-signed account/session ownership proofs. Titles sync with the account; Eve stores the actual transcripts separately.
- **Vercel sign-in:** Better Auth uses the Vercel OAuth app. In its database-free configuration, the verified Vercel account ID provides a stable, namespaced identity. New chat titles and ownership proofs are stored in **this browser** under that identity. Clearing site data, switching browsers, or losing the session secret can make those chats inaccessible.

These are **separate accounts**, even when they have the same email; they are not automatically linked and do not share history. If both sessions exist, Supabase takes precedence. Sign-out attempts to end both sessions, verifies that neither remains active, and removes the current account's saved browser credentials. It retains Vercel browser-only chat history. Existing browser-local chat IDs from earlier versions have no ownership proof and are not automatically imported; do not assume they have been deleted or migrated.

Deleting a chat removes the Supabase index entry or the local Vercel index and attempts an Eve reset. It is **not guaranteed irreversible erasure** of workflow events or sandbox files. Vercel proofs have no server-side revocation list; a retained proof can remain usable. A Supabase owner may reinsert their own signed row. Configure workflow and sandbox retention separately.

## Authentication setup

### Supabase email/password

1. Apply `supabase/migrations/20261028000000_create_tflash_chats.sql` to your Supabase project if it has not already been applied. It creates the index and user-specific RLS policies; it does not store transcripts.
2. Enable Email authentication and **Confirm email**. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` before building.
3. In **Auth → Email Templates → Confirm sign up**, paste [`supabase/templates/confirm-signup.html`](supabase/templates/confirm-signup.html) and save it. Its `{{ .Token }}` variable is required: without it the default email contains a link instead of a code. The app accepts 6–10 digits so it also works with different Supabase OTP lengths. Confirmation creates a temporary session which is not persisted in the app; the user then signs in with their password.
4. Under **Auth → URL Configuration**, set the production Site URL and allow each exact callback, including query strings, for example `http://localhost:3000/auth/callback**` and `https://your-domain.example/auth/callback**`. Add the exact preview host separately. Older confirmation links and password-recovery links must be opened in the browser that started the flow so its PKCE verifier is available. A legacy confirmation link returns to password sign-in; only recovery links keep a session for resetting the password.
5. Configure production SMTP, rate limits, and abuse controls before inviting users. Supabase's default email service is restricted.

### Vercel sign-in

Configure `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, and a stable, random `BETTER_AUTH_SECRET`. Register each intended callback, e.g. `https://your-domain.example/api/auth/callback/vercel`, in the Vercel OAuth app. These credentials are distinct from the optional Vercel *integration* OAuth credentials. The login button is disabled if the Vercel login credentials are missing.

Production Better Auth trusts only exact hosts from `APP_URL`, `BETTER_AUTH_URL`, `ALLOWED_HOSTS` (comma-separated), and Vercel's exposed deployment, branch, and production hosts. Add custom aliases explicitly when the platform does not expose them; wildcard hosts are not accepted in production. Local development also accepts localhost and the development preview domain.

### Hosting and origins

Set `APP_URL` to the public HTTPS origin. Next calls Eve through `TFLASH_INTERNAL_ORIGIN`, Vercel's deployment URL, or `APP_URL`, in that order. The internal origin must be trusted HTTPS in production and route `/eve/` to this app; it is never chosen from an incoming Host header. On deployments protected by Vercel Authentication, enable [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) and expose `VERCEL_AUTOMATION_BYPASS_SECRET` to the server. It is never forwarded from the client or sent to the browser. Redeploy after changing it.

Integration OAuth has a separate exact-origin allowlist: `APP_URL`, platform-provided Vercel hosts, and `OAUTH_ALLOWED_ORIGINS`. Register each integration app's exact `https://host/api/integrations/oauth/callback` URL. See [docs/integrations.md](docs/integrations.md) for credentials, precedence, and approvals.

## Model providers

Tflash supports OpenRouter and 14 other choices, including Vercel AI Gateway, OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio, and custom OpenAI-compatible servers. The chosen provider and model are resolved to an actual AI SDK model on each turn.

For OpenRouter, create a key at <https://openrouter.ai/keys>, add and test it in **Settings → Providers**, then choose a model. An operator may instead configure `OPENROUTER_API_KEY`; shared server keys can incur costs for any signed-in user. Add quotas, monitoring, and abuse controls before public use.

Browser-supplied keys are encrypted server-side with AES-GCM. The browser keeps an opaque, account-bound token for up to seven days; a different signed-in account cannot use it. Signing out, clearing local keys, or clearing site data removes the local copy but does not revoke the provider key. Revoke or rotate the underlying key if compromised. Older unbound browser tokens must be reconnected. Server keys are not intentionally returned to the browser.

Custom, Ollama, and LM Studio endpoints are reached **from the server**, not the user's laptop. In production each custom `host[:port]` must be explicitly listed in `CUSTOM_PROVIDER_ALLOWED_HOSTS`; an empty list denies custom endpoints. HTTPS is required except for an explicitly allowed loopback HTTP endpoint. Credential-bearing URLs, internal/metadata hostnames, and redirects are rejected. Only allow hosts and DNS you control.

## Tools, sandbox, and storage

Shell commands and **every** external MCP call require a fresh in-chat approval. Review the arguments before approving. MCP credentials are separate from model-provider keys. Local self-modification is disabled. Approvals do not replace scoped permissions, isolation, or monitoring.

New production shell sandboxes use deny-all network egress; provider calls and Eve web tools run outside the shell. The local just-bash fallback does not enforce network isolation. Existing sandboxes may retain an old policy. Eve needs a real production sandbox provider: building successfully without Docker or Vercel Sandbox does not prove live turns will work.

Persist Eve's workflow storage (or configure a suitable workflow world) and route both `/eve/` and `/.well-known/workflow/` through a self-hosted proxy. Losing workflow storage loses transcripts even when the Supabase index or browser titles remain. Consult `node_modules/eve/docs` for the deployment and sandbox model.

## Key files

- `components/app/auth-screen.tsx`, `components/brand/` — sign-in and identity.
- `lib/supabase/*`, `lib/auth*.ts`, `app/auth/*` — both account systems and callbacks.
- `app/api/chats/*`, `lib/security/*`, `agent/channels/eve.ts` — ownership and protected Eve routes.
- `lib/providers/*`, `app/api/providers/*`, `agent/agent.ts` — providers and dynamic model routing.
- `lib/integrations/*`, `agent/connections/*`, `docs/integrations.md` — MCP connections and approval policy.
