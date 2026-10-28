# Integrations (MCP tools)

T Flash ships with ten MCP connections so the agent can work against the tools a
developer already uses. Everything is driven by one catalog,
[`lib/integrations/catalog.ts`](../lib/integrations/catalog.ts); the files in
`agent/connections/` are one-liners that call `defineIntegrationConnection(id)`.

| Connection | What the agent can do | Approval |
| --- | --- | --- |
| `github` | Repos, issues, PRs, code search, Actions | asks once per session |
| `linear` | Issues, projects, cycles, comments | asks once per session |
| `notion` | Search, read, create pages and databases | asks once per session |
| `sentry` | Errors, events, traces, releases | never (read-only) |
| `supabase` | Projects, SQL, auth users, storage | every call |
| `neon` | Projects, branches, SQL | every call |
| `vercel` | Projects, deployments, logs, env vars | asks once per session |
| `posthog` | Insights, events, feature flags | asks once per session |
| `stripe` | Customers, payments, invoices | every call |
| `resend` | Send email, inspect deliveries | every call |

Approval comes from `access` in the catalog:

- `read` → no gate (nothing to approve on a lookup).
- `write` → `once()`, one approval per session per connection.
- `destructive` → `always()`, every single call.

## Authorize a service

Credentials never reach the model. Three paths exist; the browser grant wins,
then Vercel Connect, then a server env var.

### 1. One tap in Settings → Connections (default)

Open a row and press **Continue with GitHub** (or Vercel, Supabase, Linear,
Notion, Sentry, PostHog). The browser goes to the provider's own consent screen,
the developer sees exactly what access is requested, and approving returns them
to T Flash with the row already connected.

Under the hood:

| Step | Route | What happens |
| --- | --- | --- |
| 1 | `GET /api/integrations/oauth/start?id=<id>` | Builds the authorize URL with PKCE (S256) where supported and a sealed `state` that carries the integration id and the PKCE verifier. No session store needed. |
| 2 | provider consent screen | The developer approves the scopes listed in the row ("Access requested"). |
| 3 | `GET /api/integrations/oauth/callback` | Verifies the sealed state, exchanges the code (client secret, or PKCE for public clients), seals the access + refresh token with AES-256-GCM, and hands them to the app in a 5-minute HttpOnly cookie. No token in a URL or a log. |
| 4 | `GET /api/integrations/oauth/result` | The app reads the cookie once, stores the sealed record in *this browser*, deletes the cookie. |

Grants that expire are renewed silently: the app refreshes in the background
through `POST /api/integrations/oauth/refresh` before the access token lapses
(Linear 24h, PostHog 1h, Supabase 1h). Grants without a refresh token stay valid
in the browser for 7 days, renewed ones for 30.

**Operator setup.** Register one OAuth app per service and point its redirect
URI at `https://your-deployment/api/integrations/oauth/callback`:

| Service | Variables | Where to register |
| --- | --- | --- |
| GitHub | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | <https://github.com/settings/developers> |
| Linear | `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET` | <https://linear.app/settings/api/applications/new> |
| Notion | `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` | <https://www.notion.so/my-integrations> |
| Sentry | `SENTRY_OAUTH_CLIENT_ID`, `SENTRY_OAUTH_CLIENT_SECRET` | <https://sentry.io/settings/account/api/applications/> |
| Vercel | `VERCEL_INTEGRATION_CLIENT_ID`, `VERCEL_INTEGRATION_CLIENT_SECRET` | <https://vercel.com/dashboard/integrations/console> |
| Supabase | `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` | <https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration> |
| PostHog | `POSTHOG_OAUTH_CLIENT_ID` (public client, PKCE only) | <https://us.posthog.com/settings/user-oauth-applications> |

Without those variables the row says so plainly and offers two fallbacks: a
server-wide token (below) or a token the developer pastes themselves. Nothing
pretends to be connected.

Neon, Stripe and Resend do not offer OAuth for third-party apps, so their rows
say that outright rather than hiding a token field behind a button.

### 2. A token the developer pastes

Still there, one click behind **Use a personal token instead**. It goes to
`POST /api/integrations/connect`, which validates it against the service's own
probe (`/user`, `/v2/user`, `/v1/projects`, …). 401/403 means rejected; an
unreachable service offers **Save anyway**. Accepted tokens are sealed the same
way and live in that browser for 7 days.

### 3. Vercel Connect

```bash
vercel link
vercel connect create github --name t-flash     # prints a connector UID
vercel connect attach <connector-uid> --yes
vercel env pull
```

Then pin the UID so the catalog uses it:

```bash
CONNECT_GITHUB_CONNECTOR=<connector-uid>
```

By default the connection is **user-scoped**: each signed-in person authorizes
their own account, and eve pauses the turn with an authorization prompt (inline
in the chat) until they finish. Set `CONNECT_GITHUB_APP_SCOPED=1` when a single
shared bot credential is the right model.

If `CONNECT_GITHUB_CONNECTOR` is unset but `VERCEL_PROJECT_ID` exists, the
connection falls back to the project's own connector
(`<service>/<VERCEL_PROJECT_ID>`), which Vercel Connect provisions or links on
first use.

### 4. Static token on the server

Simplest for one developer or a single-tenant deployment. Put a token in the
matching variable and the connection is app-scoped for everyone:

```bash
GITHUB_MCP_TOKEN=ghp_...
SENTRY_ACCESS_TOKEN=sntrys_...
```

Full list in [`.env.example`](../.env.example). Tokens are read on the server per
request, so rotating one is an env change plus a redeploy — not a migration.

### Nothing configured

The connection still exists so the model can explain what is missing instead of
guessing, but calls fail with the service's own 401. **Settings → Connections**
shows which connections are live and which need a credential.

### Precedence at call time

`authResolverFor` in [`lib/integrations/connection.ts`](../lib/integrations/connection.ts)
tries, in order:

1. the sealed browser grant for that connection (`credentialOwner: "user"`),
2. `CONNECT_<ID>_CONNECTOR`, else the project connector,
3. the static token env var (`credentialOwner: "app"`),
4. a resolver that throws with a "Settings → Connections" hint, so the model
   reports the missing credential instead of retrying.

## Add another service

1. Add an entry to `INTEGRATIONS` in `lib/integrations/catalog.ts` (id, MCP URL,
   docs link, `connectService`, token env vars, `access`, a `probe` — the tiny
   authenticated request used to validate a pasted token — and, when the service
   supports it, `oauth.access`: the human summary of the scopes its consent
   screen asks for).
2. Add the id to `IntegrationId`.
3. Create `agent/connections/<id>.ts`:

```ts
import { defineIntegrationConnection } from "@/lib/integrations/connection";

export default defineIntegrationConnection("<id>");
```

The filename is the connection name, so tools appear as `<id>__<tool>`. Add an
icon for the settings panel in `components/settings/connections-panel.tsx`.

## Notes and sharp edges

- The hosted GitHub MCP server accepts OAuth or a personal access token; OAuth
  through GitHub requires a Copilot-enabled account, a PAT does not.
- Stripe: use a restricted key. Every call asks for approval, but a restricted key
  is still the safer blast radius.
- Supabase and Neon run SQL. Point them at a development project, not production.
- Connections are only as private as the tokens behind them: on a shared
  deployment prefer Vercel Connect (per-user) over a shared server token.
- Browser grants are sealed, not vaulted: they live in one browser's settings.
  Clearing site data disconnects them, and they do not follow a developer to a
  second machine. That is the trade for storing nothing server-side.
- Prefer OAuth over pasted tokens: the grant is scoped to what the consent
  screen showed, revocable from the service, and refreshable. When a token is
  unavoidable, use the narrowest one (GitHub fine-grained PAT, Vercel scoped
  token, Stripe restricted key) — the probe only proves it works, not that it is
  minimal.
