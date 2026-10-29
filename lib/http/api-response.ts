/**
 * The small vocabulary every JSON API route in this app shares.
 *
 * Routes used to repeat `{ "cache-control": "no-store" }`, ad-hoc error shapes
 * and content-type checks. Keeping one implementation means a response can be
 * asserted once in tests and cannot silently become cacheable or leak a stack
 * trace later.
 */

export const NO_STORE: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

/** Error codes a client may branch on. Unknown codes are still safe to display. */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INVALID_JSON"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL";

export const STATUS_FOR_CODE: Readonly<Record<ApiErrorCode, number>> = Object.freeze({
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  INVALID_JSON: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
});

export type ApiErrorBody = {
  readonly ok: false;
  readonly code: ApiErrorCode;
  readonly error: string;
  readonly requestId?: string;
};

function merge(extra?: HeadersInit): Headers {
  const headers = new Headers(NO_STORE);
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

/** A JSON success/neutral response that is never stored by a cache. */
export function jsonOk<T>(body: T, init?: { readonly status?: number; readonly headers?: HeadersInit }): Response {
  return Response.json(body, { status: init?.status ?? 200, headers: merge(init?.headers) });
}

export type JsonErrorOptions = {
  readonly status?: number;
  /** Extra top-level fields merged into the body (never override `ok`/`code`). */
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly headers?: HeadersInit;
  readonly requestId?: string;
};

/** A JSON error response with a stable code and no internal detail. */
export function jsonError(code: ApiErrorCode, error: string, options?: JsonErrorOptions): Response {
  const body: Record<string, unknown> = {
    ...options?.extra,
    ok: false,
    code,
    error,
    ...(options?.requestId ? { requestId: options.requestId } : {}),
  };
  return Response.json(body, {
    status: options?.status ?? STATUS_FOR_CODE[code],
    headers: merge(options?.headers),
  });
}

/** Only JSON bodies are accepted by the mutating API routes. */
export function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("application/json");
}

/**
 * Read a JSON body without trusting its size. Returns `undefined` when the body
 * is missing, too large, not valid JSON, or not an object. Callers decide which
 * error code fits their endpoint.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  if (!request.body) return undefined;
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return undefined;
  }
  if (raw.length > maxBytes) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}
