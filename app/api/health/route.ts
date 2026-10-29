import { authConfigured, missingAuthEnv } from "@/lib/auth";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { oauthConfigured } from "@/lib/integrations/oauth";
import { deploymentSecret } from "@/lib/security/deployment-secrets.mjs";
import { apiRoute } from "@/lib/http/api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One request that answers "why is this deployment unhappy?" without opening a
 * dashboard: it reports what is configured, never a value.
 */
async function handleGet(): Promise<Response> {
  const missing = missingAuthEnv();
  const sessionSecret = deploymentSecret("session");
  const credentialSecret = deploymentSecret("credentials");
  const secretsReady = process.env.NODE_ENV !== "production" ||
    Boolean(sessionSecret && sessionSecret.length >= 32 && credentialSecret && credentialSecret.length >= 32);
  return Response.json(
    {
      // Liveness and configuration readiness are separate; this endpoint does
      // not make a live provider, database, sandbox, or MCP connection check.
      ok: true,
      ready: secretsReady,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      auth: {
        supabase: { configured: true },
        vercel: { configured: authConfigured, missing },
      },
      security: {
        chatOwnershipKeyConfigured: Boolean(sessionSecret && sessionSecret.length >= 32),
        credentialEncryptionKeyConfigured: Boolean(credentialSecret && credentialSecret.length >= 32),
        previewDerivedKeys: process.env.NODE_ENV === "production" &&
          process.env.VERCEL_ENV === "preview" &&
          process.env.TFLASH_PREVIEW_USE_AUTH_SECRET === "1" &&
          !process.env.TFLASH_SESSION_SECRET && !process.env.PROVIDER_KEYS_SECRET && secretsReady,
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
        oauthApps: INTEGRATIONS.filter((integration) => oauthConfigured(integration.id))
          .map((integration) => integration.id),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = apiRoute("health", handleGet);
