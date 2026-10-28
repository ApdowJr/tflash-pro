# Integrations and MCP tools

Tflash has ten MCP connections, defined in `lib/integrations/catalog.ts` and registered through the files in `agent/connections/`. **Every external MCP tool call requires a fresh in-chat approval**, including reads. Shell commands also require approval. Check the exact arguments and the access granted to the service before approving.

| Connection | Examples of the available tool surface |
| --- | --- |
| GitHub | Repositories, issues, pull requests, Actions |
| Linear | Issues, projects, cycles, comments |
| Notion | Search, pages, databases |
| Sentry | Errors, events, traces, releases |
| Supabase | Projects, SQL, auth, storage |
| Neon | Projects, branches, SQL |
| Vercel | Projects, deployments, logs, environment variables |
| PostHog | Insights, events, feature flags |
| Stripe | Customers, payments, invoices |
| Resend | Email and deliveries |

The catalog's `access` field describes potential scope; it does **not** change the approval rule. Provider and MCP keys are separate: connecting OpenRouter does not connect any MCP service.

## Choose a credential

At each call, the resolver uses the first available source:

1. The current account's valid, sealed browser token, supplied by OAuth or a pasted token.
2. An explicit `CONNECT_<SERVICE>_CONNECTOR` Vercel Connect connector ID.
3. A static token in one of the integration's server environment variables.
4. When `VERCEL_PROJECT_ID` exists, a project Connect fallback named `<service>/<project-id>`. The project ID alone does **not** prove that the service is installed or authorized.
5. Otherwise the resolver reports a missing connection. Remote services can still reject an expired, under-scoped, or revoked credential.

An explicit connector defaults to user scope; `CONNECT_<SERVICE>_APP_SCOPED=1` makes its credential app-scoped. A static token is shared with every signed-in user allowed to invoke that connection. Server configuration and the presence of a project ID are **not live verification**. The Connections panel only counts valid account-owned browser grants as connected. Server configuration is shown separately and is never presented as user consent.

### Browser OAuth

In **Settings → Connections**, click **Connect** next to a service. Tflash registers a client with the vendor, sends you to its login/consent screen, and returns to the same chat. Only a successful server-side code exchange and account-bound handoff produces the **Connected** status. Cancelling or failing authorization leaves the service disconnected. No personal-token field is shown.

Linear, Notion, Sentry, Supabase, Neon, Vercel MCP, PostHog, Stripe, and Resend use their MCP-compatible authorization servers and dynamic client registration. Registration happens only when Connect is clicked. Endpoints are pinned in `lib/integrations/oauth.ts`; arbitrary user-provided discovery endpoints are not accepted. The returned client ID (and confidential client secret for Supabase) is sealed with the state and grant for exchange and renewal. Reconnecting creates a new client registration; tokens and client secrets are not logged or exposed in plaintext to the browser.

GitHub does not support automatic client registration: the **operator**, not each user, must configure `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` and register `https://your-host/api/integrations/oauth/callback`. Until then, the UI says **Setup required** rather than asking users for a token. Vercel can require approval of hosted MCP clients/callback URLs; advertising registration does not guarantee that a vendor accepts this deployment. A registration refusal is surfaced as an authorization-start failure, never a connection success. These flows require live vendor acceptance and have only been tested against mocks locally.

In production, callback origins must match `APP_URL`, a Vercel-exposed deployment/branch/production host, or an exact HTTPS origin in `OAUTH_ALLOWED_ORIGINS`. Add aliases explicitly. Vercel Tflash login credentials (`VERCEL_APP_CLIENT_ID`/`VERCEL_APP_CLIENT_SECRET`) are separate and unchanged.

Requested permissions are shown in each service’s details before connecting. Notion MCP can reach content available to the authorizing user; it is not limited to pages picked in an older REST integration. Sentry MCP includes triage writes. Stripe lets the user select account permissions. Resend delivery reads require `full_access`. PostHog requests bounded analytics/flag/experiment permissions, not its entire scope catalog; some administrative tools will remain unavailable. Review the vendor’s actual consent screen, and prefer development or sandbox accounts.

OAuth state is encrypted, short-lived, and bound to both the signed-in account and an HttpOnly browser nonce. PKCE is used where supported. The callback exchanges the code server-side without following redirects, and hands the sealed grant to the browser through a short-lived HttpOnly cookie, not through a URL. The account must remain signed in through the flow. All automatically registered flows use S256 PKCE. The five-minute handoff lifetime is separate from the seven-/30-day sealed grant lifetime.

The saved grant is encrypted and account-bound. Non-refreshable envelopes expire after seven days; refreshable ones last up to 30 days and the app attempts renewal while open. Provider expiry, revocation, offline operation, or failed refresh can still require reconnection. Sign-out or clearing site data removes the browser copy but does not revoke the service grant; revoke it at the provider when needed. Saved grants do not sync to another browser.

### Legacy personal tokens

Existing sealed personal-token records and the authenticated `/api/integrations/connect` endpoint remain compatible, but manual token entry is no longer offered in the Connections UI. New connections use consent. Legacy REST OAuth refresh grants use their original operator credentials while valid; reconnect to obtain a new MCP-native grant.

### Vercel Connect and static server tokens

Attach the connector through Vercel and set the integration's `CONNECT_<SERVICE>_CONNECTOR` variable; the exact keys are listed in `lib/integrations/catalog.ts`. Alternatively configure one of the service's static token environment variables listed in the catalog. Rotate or revoke a leaked token at the provider, then update the environment and redeploy. Do not put secrets in `NEXT_PUBLIC_*` variables.

## Adding a service

Add an entry and ID in `lib/integrations/catalog.ts`, create a thin `agent/connections/<id>.ts` calling `defineIntegrationConnection(id)`, and add an icon in `components/settings/connections-panel.tsx`. Add OAuth endpoints, scopes, and tests if supported. Keep fresh approval on every call and test with least-privileged credentials; live third-party behavior is not guaranteed by local mocks.
