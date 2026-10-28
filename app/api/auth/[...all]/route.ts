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
    // Clearing an old cookie should work even when Vercel sign-in has since
    // been disabled. The handler still checks Better Auth's normal CSRF rules.
    const isSignOut = request.method === "POST" && new URL(request.url).pathname === "/api/auth/sign-out";
    if (!authConfigured && !isSignOut) {
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
          message: "Auth is unavailable.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  };
}

export const GET = guarded(handler.GET);
export const POST = guarded(handler.POST);
