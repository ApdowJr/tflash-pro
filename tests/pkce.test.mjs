import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { browserAuthOptions, callbackFlowOptions } from "../lib/supabase/pkce.ts";

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
  assert.equal(signup.data.session, null); // The email must be confirmed first.
  assert.equal(recovery.error, null);
  const sessionCookies = () => [...cookies.keys()].filter((name) => /-auth-token(?:\.\d+)?$/.test(name));
  assert.deepEqual(sessionCookies(), []);
  assert.equal(redirects.get("signup").pathname, "/auth/callback");
  assert.equal(redirects.get("signup").searchParams.get("next"), "/");
  const signupFlow = callbackFlowOptions(redirects.get("signup"));
  const recoveryFlow = callbackFlowOptions(redirects.get("recovery"));
  assert.ok(signupFlow?.flowId);
  assert.ok(recoveryFlow?.flowId);
  assert.notEqual(signupFlow.flowId, recoveryFlow.flowId);
  assert.equal(callbackFlowOptions(new URL("https://tflash.example.test/auth/callback")), undefined);

  // The older confirmation is opened after the recovery was requested.
  const server = createServerClient(url, key, options);
  const wrongFlow = await server.auth.exchangeCodeForSession("signup", { flowId: "missing1234" });
  assert.ok(wrongFlow.error);
  assert.deepEqual(exchanges, []); // Do not consume a code with another flow's verifier.
  const first = await server.auth.exchangeCodeForSession("signup", signupFlow);
  assert.equal(first.error, null);
  assert.ok(first.data.session?.access_token);
  assert.ok(sessionCookies().length > 0); // Following the link signs in as before.
  const second = await server.auth.exchangeCodeForSession("recovery", recoveryFlow);
  assert.equal(second.error, null);
  assert.deepEqual(exchanges, ["signup", "recovery"]);
});
