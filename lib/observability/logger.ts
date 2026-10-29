/**
 * Structured, redacting logging for the server.
 *
 * Two rules keep logs safe to ship:
 *
 * 1. A log call never receives a credential by design. When an object has to be
 *    logged (an error cause, a request summary) every key that looks like a
 *    secret is replaced before serialization, so a careless `logger.error(err)`
 *    cannot leak a provider key or a session cookie.
 * 2. Production emits one JSON object per line so a log drain can index it;
 *    development emits a short readable line. Both carry the same fields.
 *
 * This module is dependency-free and safe to import from route handlers, hooks,
 * and tests under Node's type stripping (no enums, no decorators).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never written to a log sink. */
const SENSITIVE_KEY = /(secret|token|password|passwd|api[-_]?key|authorization|cookie|credential|owner[-_]?proof|private)/i;

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 500;

const MAX_LENGTH_SUFFIX = "…";

/**
 * Credential shapes that can appear inside a *message*: an upstream API quoting
 * the key it rejected, a URL with `?token=`, an Authorization header echoed
 * back. Key-based masking never sees those, so values are scrubbed too.
 */
/** Whole-value credential shapes; the entire match is replaced. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // Vendor-prefixed keys: OpenRouter/OpenAI `sk-…`, GitHub `ghp_…`, Slack
  // `xoxb-…`. A separator is required so ordinary words starting with "sk"
  // are left alone. Lookbehind stands in for a word boundary so a key glued to
  // punctuation is still caught.
  /(?<![A-Za-z0-9_])(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{6,}/g,
  // Google API keys.
  /(?<![A-Za-z0-9_])AIza[A-Za-z0-9_-]{10,}/g,
  // JSON Web Tokens (Supabase/provider session material).
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // "Authorization: Bearer <value>" anywhere inside a string.
  /(?<![A-Za-z0-9])Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * `token=value` style assignments. The label is kept so a log line still reads
 * sensibly ("refresh_token=[redacted]"), and only the value is masked.
 */
const ASSIGNMENT_PATTERN = /(?<![A-Za-z0-9])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|owner_?proof)=[^&\s"']{6,}/gi;

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}${MAX_LENGTH_SUFFIX}` : value;
}

/** Mask credential-shaped substrings, then bound the length. */
function scrub(value: string): string {
  let scrubbed = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "[redacted]");
  }
  scrubbed = scrubbed.replace(ASSIGNMENT_PATTERN, (match) => `${match.slice(0, match.indexOf("=") + 1)}[redacted]`);
  return truncate(scrubbed);
}

function summarizeError(error: Error): Record<string, unknown> {
  const record: Record<string, unknown> = {
    name: error.name,
    message: scrub(error.message),
  };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") record.code = scrub(code);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) record.cause = summarizeError(cause);
  return record;
}

/**
 * Convert arbitrary log input into something safe to serialize: secrets masked,
 * cycles cut, long strings truncated, Errors expanded.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "string") return scrub(value as string);
  if (type === "number" || type === "boolean") return value;
  if (type === "bigint") return String(value);
  if (type === "function") return "[function]";
  if (value instanceof Error) return summarizeError(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
      return items;
    }
    if (value instanceof Map) {
      return redact(Object.fromEntries(value), depth + 1, seen);
    }
    if (value instanceof Set) {
      return redact([...value], depth + 1, seen);
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1, seen);
    }
    return output;
  }
  return String(value);
}

/** Random, non-guessable id used to correlate a response with its log lines. */
export function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random.replace(/-/g, "").slice(0, 24);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Accept a caller-provided id only if it is short and alphanumeric. */
export function normalizeRequestId(candidate: string | null | undefined): string | undefined {
  if (!candidate) return undefined;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(candidate) ? candidate : undefined;
}

function resolveLevel(level: LogLevel | undefined): LogLevel {
  if (level) return level;
  const configured = (process.env.TFLASH_LOG_LEVEL ?? "").toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/** True when a message at `level` would be written. */
export function logEnabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[resolveLevel(undefined)];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ level: "error", scope: "logger", message: "unserializable log payload" });
  }
}

function formatFields(fields?: LogFields): string {
  if (!fields) return "";
  const entries = Object.entries(redact(fields) as Record<string, unknown>)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : safeStringify(value)}`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

function write(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  if (!logEnabled(level)) return;
  const payload: Record<string, unknown> = {
    level,
    scope,
    message: scrub(message),
    time: new Date().toISOString(),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = process.env.NODE_ENV === "production"
    ? safeStringify(payload)
    : `${level.toUpperCase()} [${scope}] ${payload.message}${formatFields(fields)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
};

/** Create a logger bound to a subsystem name, e.g. `createLogger("providers")`. */
export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel) => (message: string, fields?: LogFields) => write(level, scope, message, fields);
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`),
  };
}
