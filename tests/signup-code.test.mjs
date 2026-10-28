import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";

// Exercise the real Supabase client against an in-memory Auth service.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}});
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-key";
const { verifySignupCode } = await import("../lib/supabase/signup-code.ts");
const { forgetSignup, readPendingSignup, rememberSignup, PENDING_SIGNUP_KEY, RESEND_DELAY_MS } = await import("../lib/supabase/pending-signup.ts");

const payload = Buffer.from(JSON.stringify({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
const session = {
  access_token: `eyJhbGciOiJub25lIn0.${payload}.test`,
  refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600,
  user: { id: "test-user", email: "test@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("a signup code is verified without returning or persisting its temporary session", async () => {
  const calls = [];
  await withFetch(async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/verify") return Response.json(session);
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request ${url.pathname}`);
  }, async () => {
    assert.deepEqual(await verifySignupCode("test@example.test", "00123456"), { ok: true });
  });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.email, "test@example.test");
  assert.equal(body.token, "00123456");
  assert.equal(body.type, "signup");
  assert.equal(calls[1].url.searchParams.get("scope"), "local");
});

test("invalid or expired codes stay on the verification step", async () => {
  await withFetch(async () => Response.json({ code: "otp_expired", msg: "Token has expired or is invalid" }, { status: 403 }), async () => {
    assert.deepEqual(await verifySignupCode("test@example.test", "99999999"), { ok: false, reason: "invalid" });
  });
});

test("incomplete and unavailable verification responses do not count as success", async () => {
  await withFetch(async () => Response.json({}), async () => {
    assert.deepEqual(await verifySignupCode("test@example.test", "12345678"), { ok: false, reason: "unavailable" });
  });
  await withFetch(async () => { throw new Error("offline"); }, async () => {
    assert.deepEqual(await verifySignupCode("test@example.test", "12345678"), { ok: false, reason: "unavailable" });
  });
});

test("confirmation succeeds even if revoking its isolated temporary session fails", async () => {
  await withFetch(async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/verify") return Response.json(session);
    if (url.pathname === "/auth/v1/logout") throw new Error("offline");
    throw new Error(`Unexpected request ${url.pathname}`);
  }, async () => {
    assert.deepEqual(await verifySignupCode("test@example.test", "12345678"), { ok: true });
  });
});

test("the signup email template contains a code rather than a confirmation link", async () => {
  const template = await readFile(new URL("../supabase/templates/confirm-signup.html", import.meta.url), "utf8");
  assert.match(template, /\{\{\s*\.Token\s*\}\}/);
  assert.doesNotMatch(template, /\{\{\s*\.ConfirmationURL\s*\}\}/);
});

test("pending verification remembers only a valid email and a bounded resend deadline", () => {
  const original = globalThis.sessionStorage;
  const values = new Map();
  globalThis.sessionStorage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  try {
    const resendAt = Date.now() + RESEND_DELAY_MS * 100;
    rememberSignup({ email: "test@example.test", resendAt, password: "not stored", token: "not stored" });
    assert.deepEqual(Object.keys(JSON.parse(values.get(PENDING_SIGNUP_KEY))).sort(), ["email", "resendAt"]);
    const saved = readPendingSignup();
    assert.equal(saved.email, "test@example.test");
    assert.ok(saved.resendAt <= Date.now() + RESEND_DELAY_MS);
    values.set(PENDING_SIGNUP_KEY, JSON.stringify({ email: "bad address", resendAt: 1 }));
    assert.equal(readPendingSignup(), null);
    forgetSignup();
    assert.equal(values.size, 0);
    globalThis.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    assert.equal(readPendingSignup(), null);
    assert.doesNotThrow(() => rememberSignup({ email: "test@example.test", resendAt: 1 }));
    assert.doesNotThrow(forgetSignup);
  } finally {
    if (original === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = original;
  }
});
