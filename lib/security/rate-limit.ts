/**
 * Best-effort, in-process rate limiting.
 *
 * Scope, honestly stated: this counter lives in one Node process. On a
 * serverless platform each instance keeps its own window, so it blunts
 * accidental loops, a runaway client retry storm, and casual abuse of the
 * expensive endpoints — it is not a distributed quota and must not be used to
 * enforce billing, licensing, or per-account legal limits. Put a platform-level
 * limiter (or WAF) in front of the deployment for those.
 *
 * The API surface is pure so it can be tested without a server: pass `now` to
 * make time deterministic.
 */

export type RateLimitRule = {
  /** Stable bucket name, e.g. "providers:test". */
  readonly bucket: string;
  /** Requests allowed per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets; 0 when not limited. */
  readonly retryAfterSeconds: number;
  readonly resetAt: number;
};

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still oversized (a flood of distinct keys): drop the oldest insertions.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const excess = windows.size - MAX_TRACKED_KEYS + 1;
    let removed = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/**
 * Consume one slot for `key` under `rule`.
 *
 * `allowListed` short-circuits for trusted internal callers; it is a caller
 * decision, never derived from a header.
 */
export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  options?: { readonly now?: number; readonly allowListed?: boolean },
): RateLimitDecision {
  const now = options?.now ?? Date.now();
  const resetAtDefault = now + rule.windowMs;
  if (options?.allowListed) {
    return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0, resetAt: resetAtDefault };
  }

  sweep(now);
  const bucketKey = `${rule.bucket}:${key}`;
  const existing = windows.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    windows.set(bucketKey, { count: 1, resetAt: resetAtDefault });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - 1),
      retryAfterSeconds: 0,
      resetAt: resetAtDefault,
    };
  }

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      limit: rule.limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: rule.limit,
    remaining: rule.limit - existing.count,
    retryAfterSeconds: 0,
    resetAt: existing.resetAt,
  };
}

/**
 * Identify the caller for limiting purposes: the authenticated principal when
 * there is one, otherwise the closest proxy-reported address.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it,
 * so this value is used only as a coarse bucket key and never for authorization.
 */
export function rateLimitKey(request: Request, principalId?: string): string {
  if (principalId) return `user:${principalId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const candidate = forwarded || realIp || "";
  return /^[0-9a-fA-F:.]{3,64}$/.test(candidate) ? `ip:${candidate}` : "ip:unknown";
}

/** Headers that tell a well-behaved client when to come back. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAt / 1000)),
  };
  if (!decision.allowed) headers["retry-after"] = String(decision.retryAfterSeconds);
  return headers;
}

/** Test/utility hook: forget every window. */
export function resetRateLimits(): void {
  windows.clear();
}
