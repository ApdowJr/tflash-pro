import { betterAuth } from "better-auth";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Compile-time module evaluation (Next/eve builds) must not require secrets. */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event?.startsWith("build") === true ||
    (process.argv[1]?.includes("/eve/") === true && process.argv.includes("build"))
  );
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
    .map((value) => {
      try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).host;
      } catch {
        return value;
      }
    });
  if (configured.length > 0) return Array.from(new Set(configured));

  // Fail closed for unknown hosts instead of crashing during `next build`.
  // Set ALLOWED_HOSTS (comma-separated) or APP_URL for self-hosted production.
  console.warn(
    "[auth] No trusted deployment hosts configured; allowing local + preview hosts only.",
  );
  return ["localhost:*", "127.0.0.1:*", "*.e2b.app"];
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "development") return `development-${name}`;
  // `next build` imports route modules to collect their config. Real server
  // requests still require the variable, so keep this placeholder build-only.
  if (isBuildPhase()) {
    console.warn(`[auth] ${name} is unset; using a build-only placeholder.`);
    return `build-only-${name}`;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

export const auth = betterAuth({
  baseURL: {
    allowedHosts: getAllowedHosts(),
    protocol: process.env.NODE_ENV === "development" ? "auto" : "https",
  },
  secret: requireEnvironmentVariable("BETTER_AUTH_SECRET"),
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
  socialProviders: {
    vercel: {
      clientId: requireEnvironmentVariable("VERCEL_APP_CLIENT_ID"),
      clientSecret: requireEnvironmentVariable("VERCEL_APP_CLIENT_SECRET"),
      scope: ["openid", "email", "profile"],
    },
  },
});
