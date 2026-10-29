import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

// The route wrapper and limit guards use the `@/` path alias, so the loader has
// to understand tsconfig paths the same way the Next build does.
register();

process.env.NODE_ENV = "production";
process.env.TFLASH_LOG_LEVEL = "error";

const { createLogger, newRequestId, normalizeRequestId, redact } = await import("../lib/observability/logger.ts");
const { isJsonRequest, jsonError, jsonOk, readJsonObject, STATUS_FOR_CODE } = await import("../lib/http/api-response.ts");
const { apiRoute, REQUEST_ID_HEADER } = await import("../lib/http/api-route.ts");
const { consumeRateLimit, rateLimitKey, rateLimitHeaders, resetRateLimits } = await import("../lib/security/rate-limit.ts");
const { guardRateLimit, RATE_LIMITS } = await import("../lib/security/rate-limits.ts");

test("logs never contain credential-shaped values", () => {
  const redacted = redact({
    apiKey: "sk-live-123",
    headers: { authorization: "Bearer abc", cookie: "sb-token=1", accept: "application/json" },
    nested: [{ ownerProof: "proof", name: "tflash" }],
    long: "x".repeat(900),
    error: Object.assign(new Error("provider rejected key sk-live-123"), { code: "MODEL_CALL_FAILED" }),
  });

  const serialized = JSON.stringify(redacted);
  for (const secret of ["sk-live-123", "Bearer abc", "sb-token=1", "proof"]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(serialized.includes("application/json"), true, "non-secret fields stay readable");
  assert.equal(redacted.error.code, "MODEL_CALL_FAILED");
  assert.equal(String(redacted.long).length, 501);
});

test("cycles and unsupported values do not crash a log call", () => {
  const value = { name: "loop" };
  value.self = value;
  value.fn = () => {};
  value.when = new Date("2026-10-29T00:00:00.000Z");
  const output = redact(value);
  assert.equal(output.self, "[circular]");
  assert.equal(output.fn, "[function]");
  assert.equal(output.when, "2026-10-29T00:00:00.000Z");
});

test("request ids are opaque, short and only echoed when well formed", () => {
  const id = newRequestId();
  assert.match(id, /^[a-zA-Z0-9_-]{8,64}$/);
  assert.equal(normalizeRequestId(id), id);
  assert.equal(normalizeRequestId("short"), undefined);
  assert.equal(normalizeRequestId("bad id with spaces"), undefined);
  assert.equal(normalizeRequestId("<script>alert(1)</script>"), undefined);
});

test("log helpers are callable with hostile field shapes", () => {
  const logger = createLogger("test").child("child");
  assert.doesNotThrow(() => logger.warn("payload", { nested: { token: "abc" }, list: [1, 2, 3] }));
});

test("JSON responses are never cacheable and carry stable error codes", async () => {
  const ok = jsonOk({ value: 1 });
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await ok.json(), { value: 1 });

  const error = jsonError("RATE_LIMITED", "slow down", { extra: { retryAfterSeconds: 3 } });
  assert.equal(error.status, STATUS_FOR_CODE.RATE_LIMITED);
  assert.equal(error.headers.get("cache-control"), "no-store");
  assert.deepEqual(await error.json(), {
    ok: false,
    code: "RATE_LIMITED",
    error: "slow down",
    retryAfterSeconds: 3,
  });

  const unauthorized = jsonError("UNAUTHORIZED", "Sign in to continue.");
  assert.equal(unauthorized.status, 401);
});

test("JSON body reading is bounded and rejects non-objects", async () => {
  assert.equal(isJsonRequest(new Request("https://x.test", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" } })), true);
  assert.equal(isJsonRequest(new Request("https://x.test", { method: "POST", headers: { "content-type": "text/plain" } })), false);

  const post = (body) => new Request("https://x.test/api", { method: "POST", body, headers: { "content-type": "application/json" } });
  assert.deepEqual(await readJsonObject(post('{"a":1}'), 100), { a: 1 });
  assert.equal(await readJsonObject(post("[1,2]"), 100), undefined);
  assert.equal(await readJsonObject(post("null"), 100), undefined);
  assert.equal(await readJsonObject(post("not json"), 100), undefined);
  assert.equal(await readJsonObject(post(JSON.stringify({ a: "x".repeat(500) })), 100), undefined);
});

test("the route wrapper echoes a safe request id and hides internal failures", async () => {
  const okRoute = apiRoute("test:ok", async () => Response.json({ ok: true }));
  const response = await okRoute(new Request("https://x.test/api/test", { headers: { [REQUEST_ID_HEADER]: "client-supplied-id-1" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(REQUEST_ID_HEADER), "client-supplied-id-1");

  const failing = apiRoute("test:fail", async () => {
    throw new Error("database password is hunter2");
  });
  const failure = await failing(new Request("https://x.test/api/test"));
  assert.equal(failure.status, 500);
  assert.match(failure.headers.get(REQUEST_ID_HEADER) ?? "", /^[a-zA-Z0-9_-]{8,64}$/);
  const body = await failure.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "INTERNAL");
  assert.equal(JSON.stringify(body).includes("hunter2"), false);

  // An untrusted id is replaced, never reflected.
  const hostile = await okRoute(new Request("https://x.test/api/test", { headers: { [REQUEST_ID_HEADER]: "<script>" } }));
  assert.notEqual(hostile.headers.get(REQUEST_ID_HEADER), "<script>");
});

test("rate limits open a fixed window, then reject with retry metadata", () => {
  resetRateLimits();
  const rule = { bucket: "unit", limit: 2, windowMs: 1_000 };
  const first = consumeRateLimit("alice", rule, { now: 0 });
  const second = consumeRateLimit("alice", rule, { now: 10 });
  const third = consumeRateLimit("alice", rule, { now: 20 });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds, 1);
  assert.equal(rateLimitHeaders(third)["retry-after"], "1");

  // Separate callers have separate buckets, and the next window reopens.
  assert.equal(consumeRateLimit("bob", rule, { now: 20 }).allowed, true);
  assert.equal(consumeRateLimit("alice", rule, { now: 1_000 }).allowed, true);
});

test("rate limit keys prefer the authenticated principal", () => {
  const request = new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
  assert.equal(rateLimitKey(request, "user-1"), "user:user-1");
  assert.equal(rateLimitKey(request), "ip:203.0.113.7");
  assert.equal(rateLimitKey(new Request("https://x.test", { headers: { "x-forwarded-for": "not an ip" } })), "ip:unknown");
});

test("guarded routes return a 429 JSON body with retry headers", async () => {
  resetRateLimits();
  const rule = RATE_LIMITS.providerTest;
  const request = () => new Request("https://x.test/api/providers/test", { method: "POST", headers: { "x-forwarded-for": "198.51.100.9" } });
  for (let index = 0; index < rule.limit; index += 1) {
    assert.equal(guardRateLimit("providerTest", request()), undefined);
  }
  const limited = guardRateLimit("providerTest", request());
  assert.ok(limited);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
  const body = await limited.json();
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(typeof body.retryAfterSeconds, "number");
  resetRateLimits();
});
