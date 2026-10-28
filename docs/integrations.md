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

Credentials never reach the model, and a pasted token never reaches the server's
environment. There are three ways to give a connection a credential. The browser
token wins, then Vercel Connect, then a server env var.

### 1. Paste a token in Settings → Connections (quickest)

Every connection row has a token field. Paste a GitHub PAT, a Vercel token, a
Supabase access token, and the row flips to **Connected · this browser**.

What happens on **Connect**:

1. The token goes to `POST /api/integrations/connect` with the connection id.
2. The route calls the service's own probe (`/user`, `/v2/user`, `/v1/projects`,
   …) with the token. 401/403 means it is rejected; an unreachable service is not
   a verdict, so the UI offers **Save anyway**.
3. On success the token is sealed with AES-256-GCM (`lib/secrets.ts`, key derived
   from `PROVIDER_KEYS_SECRET`) and stored in **this browser's** settings.

From then on every chat request carries `x-tflash-integrations`: an array of
sealed tokens (max 12). `agent/channels/eve.ts` copies that header into the
session attributes, and only the server opens it, per connection, at call time.
Sealed tokens expire after 7 days; **Disconnect** deletes the local copy.

Nothing is written to the database, so two browsers in the same account are
independent. That is the trade: no server-side vault, no cross-device sync.

### 2. Vercel Connect

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
their own GitHub account, and eve pauses the turn with an authorization prompt
(inline in the chat) until they finish. Set `CONNECT_GITHUB_APP_SCOPED=1` when a
single shared bot credential is the right model.

If `CONNECT_GITHUB_CONNECTOR` is unset but `VERCEL_PROJECT_ID` exists, the
connection falls back to the project's own connector
(`<service>/<VERCEL_PROJECT_ID>`), which Vercel Connect provisions or links on
first use.

### 3. Static token on the server

Simplest for one developer or a single-tenant deployment. Put a token in the
matching variable and the connection is app-scoped for everyone:

```bash
GITHUB_MCP_TOKEN=ghp_...
SENTRY_ACCESS_TOKEN=sntrys_...
```

Full list in [`.env.example`](../.env.example). Tokens are read on the server per
request, so rotating one is an env change plus a redeploy — not a migration.
Use this for a shared deployment; use the paste flow for a personal one.

### Nothing configured

The connection still exists so the model can explain what is missing instead of
guessing, but calls fail with the service's own 401. **Settings → Connections**
shows which connections are live and which need a credential.

### Precedence at call time

`authResolverFor` in [`lib/integrations/connection.ts`](../lib/integrations/connection.ts)
tries, in order:

1. the sealed browser token for that connection (`credentialOwner: "user"`),
2. `CONNECT_<ID>_CONNECTOR`, else the project connector,
3. the static token env var (`credentialOwner: "app"`),
4. a resolver that throws with a "Settings → Connections" hint, so the model
   reports the missing credential instead of retrying.

## Add another service

1. Add an entry to `INTEGRATIONS` in `lib/integrations/catalog.ts` (id, MCP URL,
   docs link, `connectService`, token env vars, `access`, and a `probe` — the
   tiny authenticated request used to validate a pasted token).
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
- Pasted tokens are sealed, not encrypted-at-rest-in-a-database: they live in one
  browser's settings. Clearing site data disconnects them. Prefer the narrowest
  token each service offers (GitHub fine-grained PAT, Vercel scoped token,
  Stripe restricted key) — the probe only proves the token works, not that it is
  minimal.
