/**
 * Shared, secret-free integration (MCP connection) catalog.
 *
 * Imported by client components, API routes, and the agent's connection files.
 * It must never read `process.env`; only `connection.ts` resolves credentials.
 *
 * One file per connection still lives in `agent/connections/` because eve takes
 * the connection name from the filename — each of those files is a three-line
 * call into `defineIntegrationConnection(id)` so this catalog stays the single
 * source of truth.
 */

export type IntegrationCategory =
  | "code"
  | "data"
  | "product"
  | "ops"
  | "communication";

/** How risky the connection's tool surface is, which drives its approval gate. */
export type IntegrationAccess = "read" | "write" | "destructive";

export type IntegrationId =
  | "github"
  | "linear"
  | "sentry"
  | "posthog"
  | "notion"
  | "supabase"
  | "neon"
  | "vercel"
  | "stripe"
  | "resend";

/** Cheap authenticated request used to prove a pasted token works. */
export type IntegrationProbe = {
  readonly url: string;
  readonly method?: "GET" | "POST";
  /** `bearer` sends `Authorization: Bearer <token>`; `raw` sends the token verbatim. */
  readonly authorization?: "bearer" | "raw";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type IntegrationInfo = {
  readonly id: IntegrationId;
  readonly name: string;
  /** Model-facing description. Written for an LLM choosing a tool, not a human. */
  readonly description: string;
  readonly summary: { readonly en: string; readonly so: string };
  readonly category: IntegrationCategory;
  /** Remote MCP endpoint (Streamable HTTP / SSE). */
  readonly mcpUrl: string;
  readonly docsUrl: string;
  /** Vercel Connect service identifier used to build the default connector UID. */
  readonly connectService: string;
  /** Environment variables that can hold a static bearer token instead of OAuth. */
  readonly tokenEnvKeys: readonly string[];
  /** Environment variable that pins an explicit Vercel Connect connector UID. */
  readonly connectorEnvKey: string;
  /** Environment variable that flips the Connect credential to app scope. */
  readonly appScopeEnvKey: string;
  readonly access: IntegrationAccess;
  /** Validation endpoint for a token pasted in the UI. Omitted when there is none. */
  readonly probe?: IntegrationProbe;
  /** Allow-list of remote tool names. Omitted means "every tool the server publishes". */
  readonly tools?: readonly string[];
  readonly featured?: boolean;
  /** Extra setup note shown in the UI (e.g. a plan requirement). */
  readonly note?: { readonly en: string; readonly so: string };
  /**
   * Present when the service can be authorized with OAuth instead of a pasted
   * token. `access` is the human summary of what the consent screen asks for;
   * the endpoints and scopes live in `oauth.ts` (server-only).
   */
  readonly oauth?: { readonly access: { readonly en: string; readonly so: string } };
};

export const INTEGRATIONS: readonly IntegrationInfo[] = [
  {
    id: "github",
    name: "GitHub",
    description:
      "GitHub repositories, issues, pull requests, code search, and Actions runs for the signed-in developer.",
    summary: {
      en: "Repos, issues, pull requests, code search and Actions.",
      so: "Repo-yada, issues, pull requests, raadinta code-ka iyo Actions.",
    },
    category: "code",
    mcpUrl: "https://api.githubcopilot.com/mcp/",
    docsUrl: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
    connectService: "github",
    tokenEnvKeys: ["GITHUB_MCP_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN"],
    connectorEnvKey: "CONNECT_GITHUB_CONNECTOR",
    appScopeEnvKey: "CONNECT_GITHUB_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Repositories, issues, pull requests, Actions and your profile",
        so: "Repo-yada, issues, pull requests, Actions iyo profile-kaaga",
      },
    },
    probe: { url: "https://api.github.com/user" },
    featured: true,
    note: {
      en: "The administrator must configure a GitHub OAuth app before users can authorize access.",
      so: "Maamuluhu waa inuu diyaariyaa GitHub OAuth app ka hor inta isticmaaluhu oggolaan gelitaanka.",
    },
  },
  {
    id: "linear",
    name: "Linear",
    description:
      "Read and write the team's Linear workspace: issues, projects, cycles, comments, and labels.",
    summary: {
      en: "Issues, projects, cycles and comments.",
      so: "Issues, projects, cycles iyo comments.",
    },
    category: "product",
    mcpUrl: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp",
    connectService: "linear",
    tokenEnvKeys: ["LINEAR_API_TOKEN"],
    connectorEnvKey: "CONNECT_LINEAR_CONNECTOR",
    appScopeEnvKey: "CONNECT_LINEAR_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Issues, projects, cycles and comments in your workspace",
        so: "Issues, projects, cycles iyo comments workspace-kaaga",
      },
    },
    probe: {
      url: "https://api.linear.app/graphql",
      method: "POST",
      authorization: "raw",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ viewer { id name } }" }),
    },
    featured: true,
  },
  {
    id: "notion",
    name: "Notion",
    description:
      "Search and read the team's Notion workspace, and create or update pages and databases when asked.",
    summary: {
      en: "Docs, databases, pages and wiki search.",
      so: "Dukumeenti, databases, pages iyo raadinta wiki-ga.",
    },
    category: "product",
    mcpUrl: "https://mcp.notion.com/mcp",
    docsUrl: "https://developers.notion.com/docs/mcp",
    connectService: "notion",
    tokenEnvKeys: ["NOTION_API_TOKEN"],
    connectorEnvKey: "CONNECT_NOTION_CONNECTOR",
    appScopeEnvKey: "CONNECT_NOTION_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Read and update content available to your Notion account",
        so: "Akhrinta iyo beddelidda xogta akoonkaaga Notion heli karo",
      },
    },
    probe: {
      url: "https://api.notion.com/v1/users/me",
      headers: { "notion-version": "2022-06-28" },
    },
    featured: true,
  },
  {
    id: "sentry",
    name: "Sentry",
    description:
      "Search and inspect Sentry issues, events, traces, and releases to debug production errors.",
    summary: {
      en: "Errors, traces and releases for debugging.",
      so: "Qaladaad, traces iyo releases si loo debug-gareeyo.",
    },
    category: "ops",
    mcpUrl: "https://mcp.sentry.dev/mcp",
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
    connectService: "sentry",
    tokenEnvKeys: ["SENTRY_ACCESS_TOKEN"],
    connectorEnvKey: "CONNECT_SENTRY_CONNECTOR",
    appScopeEnvKey: "CONNECT_SENTRY_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Sentry organizations, projects, issues and alerts, including triage changes",
        so: "Organizations, projects, issues iyo alerts Sentry, oo ay ku jiraan isbeddellada xalinta",
      },
    },
    probe: { url: "https://sentry.io/api/0/organizations/" },
    featured: true,
  },
  {
    id: "supabase",
    name: "Supabase",
    description:
      "Inspect Supabase projects, run SQL, and manage tables, auth users, and storage buckets.",
    summary: {
      en: "Postgres queries, auth users, storage buckets.",
      so: "Postgres queries, auth users, storage buckets.",
    },
    category: "data",
    mcpUrl: "https://mcp.supabase.com/mcp",
    docsUrl: "https://supabase.com/docs/guides/getting-started/mcp",
    connectService: "mcp.supabase.com",
    tokenEnvKeys: ["SUPABASE_ACCESS_TOKEN"],
    connectorEnvKey: "CONNECT_SUPABASE_CONNECTOR",
    appScopeEnvKey: "CONNECT_SUPABASE_APP_SCOPED",
    access: "destructive",
    oauth: {
      access: {
        en: "All projects in your Supabase organizations",
        so: "Dhammaan projects-ka organizations-kaaga Supabase",
      },
    },
    probe: { url: "https://api.supabase.com/v1/projects" },
    featured: true,
  },
  {
    id: "neon",
    name: "Neon",
    description:
      "Manage Neon Postgres projects and branches, and run SQL against a development database.",
    summary: {
      en: "Postgres projects, branches and SQL.",
      so: "Postgres projects, branches iyo SQL.",
    },
    category: "data",
    mcpUrl: "https://mcp.neon.tech/mcp",
    docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
    connectService: "neon",
    tokenEnvKeys: ["NEON_API_KEY"],
    connectorEnvKey: "CONNECT_NEON_CONNECTOR",
    appScopeEnvKey: "CONNECT_NEON_APP_SCOPED",
    access: "destructive",
    oauth: { access: { en: "Projects, database branches and SQL, including changes you approve", so: "Projects, laamaha database-ka iyo SQL, oo ay ku jiraan isbeddellada aad ansixiso" } },
    probe: { url: "https://console.neon.tech/api/v2/projects" },
  },
  {
    id: "vercel",
    name: "Vercel",
    description:
      "List and inspect Vercel projects and deployments, read build logs, and manage environment variables.",
    summary: {
      en: "Projects, deployments, build logs and env vars.",
      so: "Projects, deployments, build logs iyo env vars.",
    },
    category: "ops",
    mcpUrl: "https://mcp.vercel.com",
    docsUrl: "https://vercel.com/docs/mcp/vercel-mcp",
    connectService: "mcp.vercel.com",
    tokenEnvKeys: ["VERCEL_ACCESS_TOKEN"],
    connectorEnvKey: "CONNECT_VERCEL_CONNECTOR",
    appScopeEnvKey: "CONNECT_VERCEL_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Projects, deployments, environment variables and logs",
        so: "Projects, deployments, environment variables iyo logs",
      },
    },
    probe: { url: "https://api.vercel.com/v2/user" },
    featured: true,
  },
  {
    id: "posthog",
    name: "PostHog",
    description:
      "Query PostHog insights and events, and manage feature flags and experiments.",
    summary: {
      en: "Product analytics, insights and feature flags.",
      so: "Analytics-ka product-ka, insights iyo feature flags.",
    },
    category: "ops",
    mcpUrl: "https://mcp.posthog.com/mcp",
    docsUrl: "https://posthog.com/docs/model-context-protocol",
    connectService: "posthog",
    tokenEnvKeys: ["POSTHOG_PERSONAL_API_KEY"],
    connectorEnvKey: "CONNECT_POSTHOG_CONNECTOR",
    appScopeEnvKey: "CONNECT_POSTHOG_APP_SCOPED",
    access: "write",
    oauth: {
      access: {
        en: "Insights, events, feature flags and session data",
        so: "Insights, events, feature flags iyo xogta session-ka",
      },
    },
    probe: { url: "https://us.posthog.com/api/users/@me/" },
  },
  {
    id: "stripe",
    name: "Stripe",
    description:
      "Look up Stripe customers, payments, invoices, and subscriptions. Money-moving calls always ask first.",
    summary: {
      en: "Customers, payments, invoices and subscriptions.",
      so: "Customers, payments, invoices iyo subscriptions.",
    },
    category: "data",
    mcpUrl: "https://mcp.stripe.com",
    docsUrl: "https://docs.stripe.com/mcp",
    connectService: "stripe",
    tokenEnvKeys: ["STRIPE_SECRET_KEY"],
    connectorEnvKey: "CONNECT_STRIPE_CONNECTOR",
    appScopeEnvKey: "CONNECT_STRIPE_APP_SCOPED",
    access: "destructive",
    oauth: { access: { en: "The Stripe accounts and permissions you select on the consent screen", so: "Akoonnada Stripe iyo fasaxyada aad ka doorato bogga oggolaanshaha" } },
    probe: { url: "https://api.stripe.com/v1/balance" },
    note: {
      en: "Select a sandbox account and limited permissions on the Stripe consent screen. Every call asks for approval.",
      so: "Bogga Stripe ka dooro akoon sandbox ah iyo fasaxyo xaddidan. Wicitaan kastaa wuxuu rabaa oggolaansho.",
    },
  },
  {
    id: "resend",
    name: "Resend",
    description: "Send transactional email and inspect recent Resend messages.",
    summary: {
      en: "Send email and inspect deliveries.",
      so: "Dir email oo eeg deliveries-ka.",
    },
    category: "communication",
    mcpUrl: "https://mcp.resend.com/mcp",
    docsUrl: "https://resend.com/docs/mcp-server",
    connectService: "mcp.resend.com",
    tokenEnvKeys: ["RESEND_API_KEY"],
    connectorEnvKey: "CONNECT_RESEND_CONNECTOR",
    appScopeEnvKey: "CONNECT_RESEND_APP_SCOPED",
    access: "destructive",
    oauth: { access: { en: "Send email and read deliveries in the Resend team you authorize", so: "Dirista email-ka iyo akhrinta fariimaha kooxda Resend aad oggolaato" } },
    probe: { url: "https://api.resend.com/domains" },
  },
];

export const INTEGRATION_CATEGORIES: readonly {
  readonly id: IntegrationCategory;
  readonly label: { readonly en: string; readonly so: string };
}[] = [
  { id: "code", label: { en: "Code", so: "Code" } },
  { id: "product", label: { en: "Product & docs", so: "Product & dukumeenti" } },
  { id: "data", label: { en: "Data & billing", so: "Xogta & lacagta" } },
  { id: "ops", label: { en: "Ops & monitoring", so: "Ops & la-socodka" } },
  { id: "communication", label: { en: "Communication", so: "Isgaarsiin" } },
];

export function getIntegration(id: string): IntegrationInfo | undefined {
  return INTEGRATIONS.find((integration) => integration.id === id);
}

export function integrationOrThrow(id: string): IntegrationInfo {
  const integration = getIntegration(id);
  if (!integration) throw new Error(`Unknown integration "${id}".`);
  return integration;
}

/** Environment variables a deployer can set for this integration (no secrets here). */
export function integrationEnvKeys(integration: IntegrationInfo): readonly string[] {
  return [
    integration.connectorEnvKey,
    ...integration.tokenEnvKeys,
    integration.appScopeEnvKey,
  ];
}
