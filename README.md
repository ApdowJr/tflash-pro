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
corepack pnpm run audit:security    # registry dependency advisories
corepack pnpm run audit:bundled-zod # compiled runtime + exact backport integrity
corepack pnpm test        # local unit and mock-service tests
corepack pnpm typecheck
corepack pnpm build       # Next production build
corepack pnpm build:eve   # Eve agent build
```

CI runs these checks using dummy values. Passing them does not establish live Supabase, model-provider, OAuth, or sandbox connectivity. `/api/health` reports configuration without values; its `ready` flag checks required signing/encryption keys, not live services.

## Accounts and history

- **Supabase email/password:** new accounts are confirmed through an emailed link. Opening that link in the same browser completes confirmation and signs the user in; password recovery also uses a link. The `tflash_chats` index uses RLS and server-signed account/session ownership proofs. Titles sync with the account; Eve stores the actual transcripts separately.
- **Vercel sign-in:** Better Auth uses the Vercel OAuth app. In its database-free configuration, the verified Vercel account ID provides a stable, namespaced identity. New chat titles and ownership proofs are stored in **this browser** under that identity. Clearing site data, switching browsers, or losing the session secret can make those chats inaccessible.

Search, rename, or remove a conversation from its sidebar menu. Search matches titles immediately and, with at least two characters, looks for case-insensitive phrases in user and assistant message text across the **up to 100 conversations currently in the sidebar**. Matching excerpts appear below chat titles. It searches an Eve snapshot on demand, without creating a persistent transcript index or using an external search service; tools, reasoning and attachment metadata are excluded. Searching can take time. Expired, inaccessible, interrupted, or oversized histories are reported as incomplete rather than no matches. Each chat scan is bounded to 4 MB of stream data, 40,000 events, 1,000,000 characters per event, and 12 seconds; newly arriving messages may require another search. Supabase history is account-synced; Vercel history remains local to this browser. Renaming a Supabase conversation syncs its title with the account; Vercel titles remain browser-local. Removal asks for confirmation.

These are **separate accounts**, even when they have the same email; they are not automatically linked and do not share history. If both sessions exist, Supabase takes precedence. Sign-out attempts to end both sessions, verifies that neither remains active, and removes the current account's saved browser credentials. It retains Vercel browser-only chat history. Existing browser-local chat IDs from earlier versions have no ownership proof and are not automatically imported; do not assume they have been deleted or migrated.

Deleting a chat removes the Supabase index entry or the local Vercel index and attempts an Eve reset. It is **not guaranteed irreversible erasure** of workflow events or sandbox files. Vercel proofs have no server-side revocation list; a retained proof can remain usable. A Supabase owner may reinsert their own signed row. Configure workflow and sandbox retention separately.

## Authentication setup

### Supabase email/password

1. Before applying schema changes, verify the actual project referenced by the deployment's effective `NEXT_PUBLIC_TFLASH_SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL` when the override is absent), its recorded migration history, and its current tables/policies; do not infer that a migration was applied from a committed filename. The Supabase project connected to an admin tool may be different from the one used by the deployed app. Do not switch projects without assessing the effect on users and history; `NEXT_PUBLIC_*` configuration is baked into the build and requires a new deployment. On a new project, apply these files in version order using the approved Supabase migration workflow: `supabase/migrations/20261028075927_create_tflash_chats.sql` creates the per-user chat index and RLS policies (not transcripts), and `supabase/migrations/20261029120000_create_tflash_workspace_sync.sql` creates per-user workspace sync with RLS, then `supabase/migrations/20261029132311_widen_tflash_workspace_jsonb_size_limit.sql` raises the JSONB storage ceiling to 250 KB to allow representation overhead under the 200 KB request-byte limit. Existing projects require schema/history reconciliation before any apply or repair.
2. Enable Email authentication and **Confirm email**. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` together before building. If an integration manages these names for a different project, set both `NEXT_PUBLIC_TFLASH_SUPABASE_URL` and `NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY` for the intended environment instead; this pair takes precedence. An incomplete pair fails closed rather than silently mixing projects. All four values are public and baked into the build.
3. Use the default **Confirm signup** email template, or another template containing `{{ .ConfirmationURL }}`. No numeric-code template is needed.
4. Under **Auth → URL Configuration**, set the production Site URL and allow each exact callback, including query strings, for example `http://localhost:3000/auth/callback**` and `https://your-domain.example/auth/callback**`. Add the exact preview host separately. Open confirmation/recovery links in the browser that started the flow so its PKCE verifier is available.
5. Configure production SMTP, rate limits, and abuse controls before inviting users. Supabase's default email service is restricted.

### Vercel sign-in

Configure `VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`, and a stable, random `BETTER_AUTH_SECRET`. Register each intended callback, e.g. `https://your-domain.example/api/auth/callback/vercel`, in the Vercel OAuth app. These credentials are distinct from MCP connection authorization. The login button is disabled if the Vercel login credentials are missing.

Production Better Auth trusts only exact hosts from `APP_URL`, `BETTER_AUTH_URL`, `ALLOWED_HOSTS` (comma-separated), and Vercel's exposed deployment, branch, and production hosts. Add custom aliases explicitly when the platform does not expose them; wildcard hosts are not accepted in production. Local development also accepts localhost and the development preview domain.

### Hosting and origins

Set `APP_URL` to the public HTTPS origin. Next calls Eve through `TFLASH_INTERNAL_ORIGIN`, Vercel's deployment URL, or `APP_URL`, in that order. The internal origin must be trusted HTTPS in production and route `/eve/` to this app; it is never chosen from an incoming Host header. On deployments protected by Vercel Authentication, enable [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) and expose `VERCEL_AUTOMATION_BYPASS_SECRET` to the server. It is never forwarded from the client or sent to the browser. Redeploy after changing it.

Integration OAuth has a separate exact-origin allowlist: `APP_URL`, platform-provided Vercel hosts, and `OAUTH_ALLOWED_ORIGINS`. MCP clients register the exact callback automatically; GitHub requires an operator-registered OAuth app. Vendor client/callback approval may still be required. See [docs/integrations.md](docs/integrations.md) for credentials, precedence, and approvals.

## Model providers

Tflash supports OpenRouter and 14 other choices, including Vercel AI Gateway, OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio, and custom OpenAI-compatible servers. The chosen provider and model are resolved to an actual AI SDK model on each turn.

Choose a provider and model from the selector in the top bar. For OpenRouter, create a key at <https://openrouter.ai/keys> and add and test it in **Settings → Providers**. An operator may instead configure `OPENROUTER_API_KEY`; shared server keys can incur costs for any signed-in user. Add quotas, monitoring, and abuse controls before public use.

Browser-supplied keys are encrypted server-side with AES-GCM. The browser keeps an opaque, account-bound token for up to seven days; a different signed-in account cannot use it. Signing out, clearing local keys, or clearing site data removes the local copy but does not revoke the provider key. Revoke or rotate the underlying key if compromised. Older unbound browser tokens must be reconnected. Server keys are not intentionally returned to the browser.

Custom, Ollama, and LM Studio endpoints are reached **from the server**, not the user's laptop. In production each custom `host[:port]` must be explicitly listed in `CUSTOM_PROVIDER_ALLOWED_HOSTS`; an empty list denies custom endpoints. HTTPS is required except for an explicitly allowed loopback HTTP endpoint. Credential-bearing URLs, internal/metadata hostnames, and redirects are rejected. Only allow hosts and DNS you control.

## Voice input and read aloud

The microphone in the composer opens **Voice input**. Choose Somali or English and press **Start listening**; the browser may ask for microphone permission. Final recognized words are appended to the current draft, which you can edit before pressing Send. **Stop listening** requests the last words; closing the dialog or leaving/hiding the page aborts unfinished speech. No audio is recorded or uploaded by Tflash itself. Your browser or operating system may send audio to its own speech-recognition service, and that service's privacy terms apply.

Use **Listen** below a completed assistant response to choose a language and an available device/browser voice, then press **Play**. Playback contains only the assistant's text, not reasoning, attachments or tool data, and stops when the dialog closes or the conversation unmounts. Long responses are read in chunks; Markdown and code may be spoken literally. The browser or selected voice service may process that response text.

Both controls require compatible browser speech APIs; input also requires HTTPS and microphone access. Somali recognition and installed Somali voices are **not guaranteed**: language support, accuracy, internet needs and voice availability depend on the browser, device and speech service. Tflash requests the chosen recognition language but cannot verify that an engine honored it, so review the draft. If no matching voice is available, install one supported by your device or explicitly choose another language; the app does not silently substitute an English voice for Somali. Embedded previews may block microphone permission; open the app directly if needed. These controls use no Tflash speech-provider credentials. Automated tests mock browser APIs; no live Somali recognition or speech voice has been verified.

## Task plans and downloadable results

For substantial multi-step work, Tflash can publish a task checklist and update it as work progresses. The latest plan appears above the conversation; actual run status is separate from the agent's reported step status. Plans do not execute tasks or certify success.

Finished Markdown, text, CSV and JSON deliverables appear as preview/download cards. Content stays in the owned conversation's workflow data, not a public bucket. Downloads are text-only and bounded to 100,000 characters; original downloads never execute code. Markdown/plain-text cards also offer explicit user-click PDF/DOCX conversion (50,000 characters / 2,000 lines). Review generated content before using it. See [the phased agent roadmap](docs/agent-roadmap.md) for implementation details and storage/usage limitations.

## Research with traceable sources

Ask Tflash to research a topic and create a downloadable report. It uses Eve's existing provider-managed search where supported, reads public HTTPS pages with per-call approval, and shows requested source URLs, retrieval times and excerpts. A Markdown report accepts only app-issued source receipts from the same account/chat and requires citations and limitations. Retrieved evidence and AI synthesis are labelled separately; retrieval does not independently verify the claims.

Search depends on the selected provider/model. AI Gateway keeps its existing Exa default; supported direct OpenAI/Anthropic/Google models use native search. Direct OpenRouter/other compatible endpoints may not have search; supply public URLs instead. No provider is switched automatically. Research reports are authored as Markdown; their cards can convert plain text to PDF/DOCX on request. These tools do not need a shell sandbox; live provider search and production connectivity still need verification.

## Projects, memory, activity and documents

- **Settings → Workspace** manages up to 20 projects and 30 editable notes. The project selector above the composer associates a chat with a project. Open its conversations to find their attachments and reports. Notes are opt-in, can be disabled individually or globally, and can be scoped to one project. Deleting a project removes its scoped notes, not its conversations.
- Projects/notes are **browser-local for each account and login kind**, not encrypted, cloud-synced or shared. Never store secrets. Enabled notes and selected project instructions are sent with submitted messages to the selected model as untrusted user context. Deleting/disabling stops adding them to new prompts, not erasure of earlier provider/transcript copies. Export a JSON backup or clear them explicitly in Workspace.
- **Activity & usage** in each conversation shows tool outcomes/approval state and available timestamps without exporting arguments or outputs. Task receipts remain running until settlement. Provider-reported input/output tokens and known model costs are shown; missing costs remain unknown. This is not a full invoice or tamper-proof audit log.
- A durable server hook stops a session's turn before exceeding its selected **1–30 model calls** (default 12). Separate usage windows pause for approval at 250,000 new input tokens, 30,000 output tokens or USD 2 in reported model cost. A call can cross a threshold; parallel tools, compaction, unknown costs and delegated sessions are not a hard invoice cap. No automatic continuation is added.
- The composer's **Read PDF or DOCX** control extracts plain text to a reviewable `.txt` attachment without sending it. Imports: 2 MiB, 50 PDF pages, 100,000 text characters; no OCR/encrypted PDFs. DOCX reads the main document body only and ignores macros/external relationships. Parsing runs in a timeout-bound worker, not on the request thread. Exports are genuine PDF/DOCX binaries, not renamed text files; no rich layout preservation. Somali/English text is supported; unsupported PDF glyphs fail rather than silently disappearing.

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

## Platform hardening (2026-10-29)

The 2026-10-29 upgrade hardened the parts that only matter when something fails;
no feature or API contract was removed. See
[docs/upgrade-2026-10-29.md](docs/upgrade-2026-10-29.md) for the full rationale.

- Wrapped API routes return an `x-request-id`, log one structured line with the
  status and duration, and turn an unexpected throw into a JSON `500` with a
  stable `code` instead of a stack trace. Logs mask credential-shaped keys and
  scrub credential-shaped values (vendor key prefixes, JWTs, `Bearer …`,
  `token=…`). `TFLASH_LOG_LEVEL=debug|info|warn|error` sets the threshold.
- **In-process** rate limits (20–60 requests/minute) cover provider test and
  connect, live model listing, integration connect, document read/export and chat
  creation. They blunt retry storms and casual abuse; they are not a distributed
  quota and must not be used for billing or per-account limits. Add a platform
  limiter or WAF before opening the deployment to the public.
- Route, global and 404 error surfaces plus an offline banner replace blank
  screens. Security headers (nosniff, referrer policy, a microphone-only
  permissions policy, COOP, HSTS) are sent for every path. `X-Frame-Options` and
  `Content-Security-Policy` are intentionally not set: the app is embedded in a
  preview iframe, and a correct CSP needs per-request nonces. Both are tracked
  follow-ups.
- A web manifest makes the app installable without a service worker, so no
  conversation data is cached on a shared device. `robots.txt` disallows chat,
  API, auth and `/eve/` paths.

## Release security note

The 2026-10-29 security update reduced the registry audit from **56 advisories (7 critical) to 0** across production and development dependencies, without advisory suppressions. Next.js, Better Auth and affected transitive dependencies were patched. CI guards both the registry audit and the separate bundled-Zod finding below.

The separate Eve/Zod finding is remediated in this patch with a **version-pinned backport of the official upstream fix**, applied by pnpm during installation. Eve still reports bundled Zod 4.5.4; we do not relabel it as a newer release. The security gate verifies the exact patched shared chunk/helper hashes and checks array/map/set rejection in synchronous, asynchronous and compiled paths. Missing, altered or unknown backports fail closed. See [dependency security](docs/dependency-security.md) for provenance, reproduction and limitations.

Both security gates, local tests and builds pass for this patch. This does not establish live authentication/provider connectivity or blanket production security approval; preview validation, sandbox/workflow readiness and an authorized production rollout remain separate.
