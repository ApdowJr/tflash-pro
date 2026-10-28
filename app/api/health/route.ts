import { authConfigured, missingAuthEnv } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One request that answers "why is this deployment unhappy?" without opening a
 * dashboard: it reports what is configured, never a value.
 */
export async function GET(): Promise<Response> {
  const missing = missingAuthEnv();
  return Response.json(
    {
      ok: true,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      auth: {
        configured: authConfigured,
        missing,
      },
      providers: {
        serverKeys: [
          "OPENROUTER_API_KEY",
          "OPENAI_API_KEY",
          "ANTHROPIC_API_KEY",
          "AI_GATEWAY_API_KEY",
        ].filter((key) => Boolean(process.env[key])),
      },
      integrations: {
        connectAvailable: Boolean(process.env.VERCEL_PROJECT_ID),
        oauthApps: ["GITHUB", "LINEAR", "NOTION", "SENTRY", "VERCEL", "SUPABASE", "POSTHOG"].filter(
          (name) => Boolean(process.env[`${name}_OAUTH_CLIENT_ID`]),
        ),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
