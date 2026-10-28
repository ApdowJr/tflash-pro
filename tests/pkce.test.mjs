import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { createBrowserClient } from "@supabase/ssr";
import { browserAuthOptions, callbackFlowOptions } from "../lib/supabase/pkce.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "./config" && context.parentURL?.endsWith("/staged-callback.ts")) {
    return { url: new URL("../lib/supabase/config.ts", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}});
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
const { stageCallbackCookies } = await import("../lib/supabase/staged-callback.ts");

// Exercise the actual Supabase SSR clients against an in-memory Auth service.
// Nothing is sent to the user's real project and no email is generated.
test("confirmation and recovery links keep their own PKCE verifier", async () => {
  const cookies = new Map();
  const cookieMethods = {
    getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
    setAll: (changes) => {
      for (const { name, value, options } of changes) {
        if (options?.maxAge === 0 || value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
    },
  };
  const challenges = new Map();
  const redirects = new Map();
  const exchanges = [];
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const body = JSON.parse(init.body || "{}");
    if (url.pathname === "/auth/v1/signup" || url.pathname === "/auth/v1/recover") {
      const kind = url.pathname.endsWith("signup") ? "signup" : "recovery";
      challenges.set(kind, body.code_challenge);
      redirects.set(kind, new URL(url.searchParams.get("redirect_to")));
      return Response.json(kind === "signup" ? { id: "test-user", email: "user@example.test" } : {});
    }
    if (url.pathname === "/auth/v1/logout") {
      // Even an unavailable logout must not persist the provisional signup session.
      return Response.json({ msg: "temporarily unavailable" }, { status: 503 });
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      exchanges.push(body.auth_code);
      const challenge = createHash("sha256").update(body.code_verifier).digest("base64url");
      if (challenge !== challenges.get(body.auth_code)) {
        return Response.json({ error: "invalid_grant", error_description: "PKCE mismatch" }, { status: 400 });
      }
      const payload = Buffer.from(JSON.stringify({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      return Response.json({
        access_token: `eyJhbGciOiJub25lIn0.${payload}.test`,
        refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600,
        user: { id: "test-user", email: "user@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    throw new Error(`Unexpected mocked Auth request: ${url.pathname}`);
  };
  const url = "https://auth.example.test";
  const key = "test-publishable-key";
  const options = { global: { fetch: fakeFetch }, cookies: cookieMethods };
  const browser = createBrowserClient(url, key, { ...options, isSingleton: false, auth: browserAuthOptions });

  const signup = await browser.auth.signUp({
    email: "user@example.test", password: "testpassword", options: { emailRedirectTo: "https://tflash.example.test/auth/callback?next=%2F" },
  });
  const recovery = await browser.auth.resetPasswordForEmail("user@example.test", {
    redirectTo: "https://tflash.example.test/auth/callback?next=%2Fauth%2Freset-password",
  });
  assert.equal(signup.error, null);
  assert.equal(recovery.error, null);
  const signupFlow = callbackFlowOptions(redirects.get("signup"));
  const recoveryFlow = callbackFlowOptions(redirects.get("recovery"));
  assert.ok(signupFlow?.flowId);
  assert.ok(recoveryFlow?.flowId);
  assert.notEqual(signupFlow.flowId, recoveryFlow.flowId);
  assert.equal(callbackFlowOptions(new URL("https://tflash.example.test/auth/callback")), undefined);

  // The older confirmation is opened after the recovery was requested. Exercise
  // the real SSR cookie adapter; it must not write the signup session even if
  // logout fails, while the separate recovery verifier remains usable.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const wrongStage = stageCallbackCookies(cookieMethods);
    const wrongFlow = await wrongStage.supabase.auth.exchangeCodeForSession("signup", { flowId: "missing1234" });
    assert.ok(wrongFlow.error);
    assert.deepEqual(exchanges, []); // Do not consume a code with another flow's verifier.

    const signupStage = stageCallbackCookies(cookieMethods);
    const first = await signupStage.supabase.auth.exchangeCodeForSession("signup", signupFlow);
    assert.equal(first.error, null);
    assert.equal(first.data.redirectType, null);
    const isSessionCookie = (name) => name.includes("-auth-token") && !name.includes("-code-verifier");
    assert.equal([...cookies.keys()].some(isSessionCookie), false);
    await signupStage.commitVerifiers();
    const logout = await signupStage.supabase.auth.signOut({ scope: "local" });
    assert.ok(logout.error);
    // Never commit sign-out's later staged writes: they include all other PKCE flows.
    assert.equal([...cookies.keys()].some(isSessionCookie), false);
    assert.equal([...cookies.keys()].some((name) => name.includes(signupFlow.flowId)), false);
    assert.equal([...cookies.keys()].some((name) => name.includes(recoveryFlow.flowId)), true);

    const recoveryStage = stageCallbackCookies(cookieMethods);
    const second = await recoveryStage.supabase.auth.exchangeCodeForSession("recovery", recoveryFlow);
    assert.equal(second.error, null);
    assert.equal(second.data.redirectType, "recovery");
    assert.equal([...cookies.keys()].some(isSessionCookie), false);
    await recoveryStage.commitRecovery();
    assert.equal([...cookies.keys()].some(isSessionCookie), true);
    assert.deepEqual(exchanges, ["signup", "recovery"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a legacy confirmation preserves an already signed-in browser session", async () => {
  const cookies = new Map();
  const cookieMethods = {
    getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
    setAll: (changes) => {
      for (const { name, value, options } of changes) {
        if (options?.maxAge === 0 || value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
    },
  };
  const makeSession = (id) => {
    const payload = Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    return {
      access_token: `eyJhbGciOiJub25lIn0.${payload}.test`,
      refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600,
      user: { id, email: `${id}@example.test`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
  };
  const newSession = makeSession("new-user");
  const priorValue = `base64-${Buffer.from(JSON.stringify(makeSession("prior-user"))).toString("base64url")}`;
  let redirect;
  let challenge;
  let logoutAuthorization;
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const body = JSON.parse(init.body || "{}");
    if (url.pathname === "/auth/v1/signup") {
      challenge = body.code_challenge;
      redirect = new URL(url.searchParams.get("redirect_to"));
      return Response.json({ id: "new-user", email: "new-user@example.test" });
    }
    if (url.pathname === "/auth/v1/token") {
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge);
      return Response.json(newSession);
    }
    if (url.pathname === "/auth/v1/logout") {
      logoutAuthorization = new Headers(init.headers).get("authorization");
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mocked Auth request: ${url.pathname}`);
  };
  const browser = createBrowserClient("https://auth.example.test", "test-publishable-key", {
    global: { fetch: fakeFetch }, cookies: cookieMethods, isSingleton: false, auth: browserAuthOptions,
  });
  assert.equal((await browser.auth.signUp({
    email: "new-user@example.test", password: "testpassword",
    options: { emailRedirectTo: "https://tflash.example.test/auth/callback" },
  })).error, null);
  // Another tab may already have an authenticated account in this browser.
  cookies.set("sb-auth-auth-token", priorValue);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const staged = stageCallbackCookies(cookieMethods);
    const result = await staged.supabase.auth.exchangeCodeForSession("signup-code", callbackFlowOptions(redirect));
    assert.equal(result.error, null);
    await staged.commitVerifiers();
    await staged.supabase.auth.signOut({ scope: "local" });
    assert.equal(cookies.get("sb-auth-auth-token"), priorValue);
    assert.equal(logoutAuthorization, `Bearer ${newSession.access_token}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
