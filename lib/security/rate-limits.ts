import { consumeRateLimit, rateLimitKey, rateLimitHeaders, type RateLimitRule } from "@/lib/security/rate-limit";
import { jsonError } from "@/lib/http/api-response";

/**
 * Named limits for the endpoints whose cost is set by an outside party:
 * provider calls, MCP/connection setup, uploads, and session creation.
 *
 * Read-only routes that only touch our own data are deliberately not limited
 * here; a per-instance counter would add latency and false positives without
 * changing their cost profile.
 */
export const RATE_LIMITS = {
  /** Outbound test call to a third-party model provider. */
  providerTest: { bucket: "provider:test", limit: 20, windowMs: 60_000 },
  /** Live model catalog fetch from a provider. */
  providerModels: { bucket: "provider:models", limit: 60, windowMs: 60_000 },
  /** Storing/validating a provider credential. */
  providerConnect: { bucket: "provider:connect", limit: 30, windowMs: 60_000 },
  /** Starting the MCP/OAuth connection flow. */
  integrationConnect: { bucket: "integration:connect", limit: 30, windowMs: 60_000 },
  /** Server-side document parsing or conversion. */
  documents: { bucket: "documents", limit: 30, windowMs: 60_000 },
  /** Creating new agent sessions. */
  chatCreate: { bucket: "chat:create", limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Check a named limit for this request.
 *
 * Returns `undefined` when the caller may proceed, or a finished 429 response
 * (with `retry-after` and `x-ratelimit-*`) that the route returns immediately.
 */
export function guardRateLimit(
  name: RateLimitName,
  request: Request,
  principalId?: string,
): Response | undefined {
  const decision = consumeRateLimit(rateLimitKey(request, principalId), RATE_LIMITS[name]);
  if (decision.allowed) return undefined;
  return jsonError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
    extra: { retryAfterSeconds: decision.retryAfterSeconds },
    headers: rateLimitHeaders(decision),
  });
}
