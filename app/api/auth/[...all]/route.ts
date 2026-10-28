import { toNextJsHandler } from "better-auth/next-js";
import { auth, authConfigured, missingAuthEnv } from "@/lib/auth";

const handler = toNextJsHandler(auth);

/**
 * Accounts are optional. When the deployment has no auth credentials the
 * endpoints answer 503 with the missing names instead of crashing the lambda,
 * and the UI shows the same explanation instead of a broken sign-in button.
 */
function guarded(
  method: (request: Request) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!authConfigured) {
      return Response.json(
        {
          error: "auth_not_configured",
          message: "Accounts are not configured on this deployment.",
          missing: missingAuthEnv(),
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    try {
      return await method(request);
    } catch (error) {
      // Misconfiguration should read like misconfiguration, not like a crash.
      console.error("[auth] request failed:", error);
      return Response.json(
        {
          error: "auth_unavailable",
          message: error instanceof Error ? error.message : "Auth is unavailable.",
          allowedHosts: process.env.ALLOWED_HOSTS ?? null,
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  };
}

export const GET = guarded(handler.GET);
export const POST = guarded(handler.POST);
