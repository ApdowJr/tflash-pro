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

An explicit connector defaults to user scope; `CONNECT_<SERVICE>_APP_SCOPED=1` makes its credential app-scoped. A static token is shared with every signed-in user allowed to invoke that connection. Server configuration and the presence of a project ID are **not live verification**. The Connections panel distinguishes saved browser records, configured server credentials, and an unverified project fallback.

### Browser OAuth

GitHub, Linear, Notion, Sentry, Vercel, Supabase, and PostHog have OAuth flows when an operator has registered and configured the corresponding app. Neon, Stripe, and Resend use the pasted-token path. In **Settings → Connections**, choose the service and follow its consent screen.

| Service | OAuth variables |
| --- | --- |
| GitHub | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` |
| Linear | `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET` |
| Notion | `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` |
| Sentry | `SENTRY_OAUTH_CLIENT_ID`, `SENTRY_OAUTH_CLIENT_SECRET` |
| Vercel integration | `VERCEL_INTEGRATION_CLIENT_ID`, `VERCEL_INTEGRATION_CLIENT_SECRET` |
| Supabase | `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` |
| PostHog | `POSTHOG_OAUTH_CLIENT_ID`; optionally `POSTHOG_OAUTH_BASE_URL` for the region |

Register `https://your-host/api/integrations/oauth/callback` with each provider and set the matching client credentials privately on the server. Vercel integration credentials are **not** the `VERCEL_APP_CLIENT_ID`/`VERCEL_APP_CLIENT_SECRET` used for Tflash login. In production, callback origins must match `APP_URL`, a Vercel-exposed deployment/branch/production host, or an exact HTTPS origin in `OAUTH_ALLOWED_ORIGINS`; add aliases explicitly. Register every preview origin separately where the provider requires exact redirects.

OAuth state is encrypted, short-lived, and bound to both the signed-in account and an HttpOnly browser nonce. PKCE is used where supported. The callback exchanges the code server-side without following redirects, and hands the sealed grant to the browser through a short-lived HttpOnly cookie, not through a URL. The account must remain signed in through the flow.

The saved grant is encrypted and account-bound. Non-refreshable envelopes expire after seven days; refreshable ones last up to 30 days and the app attempts renewal while open. Provider expiry, revocation, offline operation, or failed refresh can still require reconnection. Sign-out or clearing site data removes the browser copy but does not revoke the service grant; revoke it at the provider when needed. Saved grants do not sync to another browser.

### Pasted personal token

Select **Use a personal token instead**. The server attempts a provider-specific probe; 401/403 rejects the token. A network error or inconclusive 404 allows an explicit **Save anyway**, labeled as not live-verified. A successful probe confirms only that request, not all MCP permissions or future availability. The account-bound envelope lasts seven days. Use the narrowest permissions possible, especially for databases, deployments, payments, and email.

### Vercel Connect and static server tokens

Attach the connector through Vercel and set the integration's `CONNECT_<SERVICE>_CONNECTOR` variable; the exact keys are shown in each Settings row. Alternatively configure one of the service's static token environment variables listed in the catalog. Rotate or revoke a leaked token at the provider, then update the environment and redeploy. Do not put secrets in `NEXT_PUBLIC_*` variables.

## Adding a service

Add an entry and ID in `lib/integrations/catalog.ts`, create a thin `agent/connections/<id>.ts` calling `defineIntegrationConnection(id)`, and add an icon in `components/settings/connections-panel.tsx`. Add OAuth endpoints, scopes, and tests if supported. Keep fresh approval on every call and test with least-privileged credentials; live third-party behavior is not guaranteed by local mocks.
