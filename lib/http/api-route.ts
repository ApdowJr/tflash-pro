import { createLogger, newRequestId, normalizeRequestId } from "@/lib/observability/logger";
import { jsonError } from "@/lib/http/api-response";

/**
 * One wrapper for API route handlers that adds the three things every endpoint
 * needs and none of them remembered to do consistently:
 *
 * - a request id (echoed as `x-request-id`, never trusted blindly from a client)
 * - a hard boundary, so an unexpected throw becomes a JSON 500 instead of a
 *   framework HTML error page or a leaked stack trace
 * - one structured log line with status and duration, with credentials redacted
 *
 * The handler still owns its status codes and body shape. Errors that occur
 * before a response exists are the wrapper's responsibility.
 */

export const REQUEST_ID_HEADER = "x-request-id";

export type ApiRouteContext = {
  readonly requestId: string;
  readonly logger: ReturnType<typeof createLogger>;
  readonly startedAt: number;
};

type Handler<Args extends readonly unknown[]> = (
  request: Request,
  context: ApiRouteContext,
  ...args: Args
) => Promise<Response> | Response;

function withHeaders(response: Response, requestId: string): Response {
  // A body already read (or a body-less 204) is still re-wrappable; headers are
  // copied so route-specific values such as content-type survive untouched.
  const patched = new Response(response.body, response);
  patched.headers.set(REQUEST_ID_HEADER, requestId);
  return patched;
}

/**
 * Wrap a route handler. `scope` names the subsystem in logs; keep it short
 * ("chats", "providers", "documents").
 */
export function apiRoute<Args extends readonly unknown[]>(
  scope: string,
  handler: Handler<Args>,
): (request: Request, ...args: Args) => Promise<Response> {
  const logger = createLogger(scope);
  return async (request, ...args) => {
    const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
    const startedAt = Date.now();
    const context: ApiRouteContext = { requestId, logger, startedAt };
    try {
      const response = await handler(request, context, ...args);
      const durationMs = Date.now() - startedAt;
      const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
      logger[level]("request", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs,
      });
      return withHeaders(response, requestId);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      // The error object is redacted by the logger; only the id and a generic
      // message reach the client.
      logger.error("request failed", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: 500,
        durationMs,
        error,
      });
      return withHeaders(
        jsonError("INTERNAL", "Something went wrong. Please try again.", { requestId }),
        requestId,
      );
    }
  };
}
