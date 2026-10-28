import { betterAuth } from "better-auth";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * The three variables a real account system needs. Missing any of them used to
 * throw at import time, which took the whole deployment down with a 500 — the
 * marketing page, the chat route, everything. A missing credential should
 * degrade to "accounts are off", never to "the site is broken".
 */
export const AUTH_ENV_KEYS = [
  "BETTER_AUTH_SECRET",
  "VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
] as const;

export function missingAuthEnv(): string[] {
  return AUTH_ENV_KEYS.filter((name) => {
    const value = process.env[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/** True only when a signed-in session can actually be trusted end to end. */
export const authConfigured = missingAuthEnv().length === 0;

/**
 * Process-local secret used when the deployment has none.
 *
 * Sessions signed with it cannot outlive the process and nobody else knows it,
 * so this fails closed: the UI treats accounts as unavailable when
 * `authConfigured` is false. It exists so importing this module is never fatal.
 */
function fallbackSecret(): string {
  return `unconfigured-${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

const DEVELOPMENT_ALLOWED_HOSTS = [
  "localhost:*",
  "127.0.0.1:*",
  // Sandbox / IDE previews run on a generated subdomain while in dev mode.
  "*.e2b.app",
];

function getAllowedHosts(): string[] {
  if (process.env.NODE_ENV === "development") {
    return [
      ...DEVELOPMENT_ALLOWED_HOSTS,
      ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter((host): host is string =>
        Boolean(host),
      ),
    ];
  }
  const configured = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.BETTER_AUTH_URL,
    process.env.APP_URL,
    ...(process.env.ALLOWED_HOSTS?.split(",") ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        // Production trusts only exact operator/platform hosts, never patterns,
        // credential-bearing URLs, or paths disguised as an origin.
        if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
            url.search || url.hash || /[\s*]/.test(url.host)) return [];
        return [url.host];
      } catch {
        return [];
      }
    });
  // Only operator- or platform-provided exact hosts are trusted. Custom aliases
  // that Vercel does not expose must be explicitly listed in ALLOWED_HOSTS.
  if (configured.length > 0) return Array.from(new Set(configured));

  // Fail closed for unknown hosts instead of crashing during `next build`.
  // Set ALLOWED_HOSTS (comma-separated) or APP_URL for self-hosted production.
  console.warn(
    "[auth] No trusted deployment hosts configured; Vercel sign-in will fail closed.",
  );
  // Better Auth needs a non-empty list. .invalid is reserved and cannot be a
  // real deployment host; Supabase email/password remains available.
  return ["tflash-auth-unconfigured.invalid"];
}

const vercelProvider =
  process.env.VERCEL_APP_CLIENT_ID && process.env.VERCEL_APP_CLIENT_SECRET
    ? {
        clientId: process.env.VERCEL_APP_CLIENT_ID,
        clientSecret: process.env.VERCEL_APP_CLIENT_SECRET,
        scope: ["openid", "email", "profile"],
      }
    : undefined;

if (!authConfigured && process.env.NODE_ENV === "production") {
  console.warn(
    `[auth] Vercel sign-in is disabled: missing ${missingAuthEnv().join(", ")}. Supabase sign-in remains available.`,
  );
}

export const auth = betterAuth({
  baseURL: {
    allowedHosts: getAllowedHosts(),
    protocol: process.env.NODE_ENV === "development" ? "auto" : "https",
  },
  secret: process.env.BETTER_AUTH_SECRET?.trim() || fallbackSecret(),
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    disableSessionRefresh: true,
    cookieCache: {
      enabled: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      refreshCache: false,
      strategy: "jwe",
    },
  },
  ...(vercelProvider ? { socialProviders: { vercel: vercelProvider } } : {}),
});
