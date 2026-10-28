import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { makeSignature, symmetricEncodeJWT } from "better-auth/crypto";

// Exercise Better Auth's real JWE cookies and getSession, without a live OAuth provider.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}});
process.env.NODE_ENV = "production";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-only-0123456789abcdef";
process.env.VERCEL_APP_CLIENT_ID = "test-client";
process.env.VERCEL_APP_CLIENT_SECRET = "test-client-secret";
process.env.APP_URL = "https://app.example.test";
const { auth } = await import("../lib/auth.ts");
const { vercelPrincipal } = await import("../lib/auth-vercel.ts");
const context = await auth.$context;

async function cookies({ userId, accountId = "stable-vercel-subject", accountUserId = userId, providerId = "vercel", chunked = false }) {
  const now = new Date();
  const expiry = new Date(now.getTime() + 60 * 60 * 1000);
  const token = `session-token-${userId}`;
  const signed = encodeURIComponent(`${token}.${await makeSignature(token, context.secret)}`);
  const user = { id: userId, name: "Test User", email: "test@example.test", emailVerified: true, createdAt: now, updatedAt: now };
  const session = { id: `session-${userId}`, token, userId, expiresAt: expiry, createdAt: now, updatedAt: now };
  const data = await symmetricEncodeJWT({ session, user, version: "1", updatedAt: Date.now() }, context.secretConfig, "better-auth-session", 3600);
  const account = await symmetricEncodeJWT({ providerId, accountId, userId: accountUserId }, context.secretConfig, "better-auth-account", 3600);
  const accountName = context.authCookies.accountData.name;
  const accountParts = chunked
    ? [`${accountName}.0=${account.slice(0, 50)}`, `${accountName}.1=${account.slice(50)}`]
    : [`${accountName}=${account}`];
  return new Headers({
    host: "app.example.test", "x-forwarded-proto": "https",
    cookie: [`${context.authCookies.sessionToken.name}=${signed}`, `${context.authCookies.sessionData.name}=${data}`, ...accountParts].join("; "),
  });
}

test("Vercel identities stay stable across stateless Better Auth logins", async () => {
  const first = await vercelPrincipal(await cookies({ userId: "ephemeral-user-1" }));
  const second = await vercelPrincipal(await cookies({ userId: "ephemeral-user-2", chunked: true }));
  assert.ok(first?.id.startsWith("vercel:"));
  assert.equal(first.id, second?.id);
  assert.equal(first.kind, "vercel");
  assert.equal(first.email, "test@example.test");
});

test("Vercel identities reject a mismatched, missing, or untrusted account cookie", async () => {
  assert.equal(await vercelPrincipal(await cookies({ userId: "user-1", accountUserId: "someone-else" })), null);
  assert.equal(await vercelPrincipal(await cookies({ userId: "user-1", providerId: "github" })), null);
  const headers = await cookies({ userId: "user-1" });
  headers.set("cookie", headers.get("cookie").replace(`${context.authCookies.accountData.name}=`, `${context.authCookies.accountData.name}=tampered`));
  assert.equal(await vercelPrincipal(headers), null);
  assert.equal(await vercelPrincipal(new Headers()), null);
});

test("the real Better Auth Vercel OAuth callback issues an account-bound session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const address = typeof url === "string" ? url : url.toString();
    if (address === "https://api.vercel.com/login/oauth/token") {
      return Response.json({ access_token: "fake-provider-token", token_type: "Bearer", expires_in: 3600 });
    }
    if (address === "https://api.vercel.com/login/oauth/userinfo") {
      return Response.json({ sub: "real-shaped-vercel-subject", name: "Test User", email: "test@example.test", email_verified: true });
    }
    throw new Error(`Unexpected mock OAuth request: ${address}`);
  };
  try {
    async function signIn() {
      const login = await auth.handler(new Request("https://app.example.test/api/auth/sign-in/social", {
        method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" },
        body: JSON.stringify({ provider: "vercel", callbackURL: "/" }),
      }));
      assert.equal(login.status, 200);
      const start = await login.json();
      const state = new URL(start.url).searchParams.get("state");
      assert.ok(state);
      const stateCookies = login.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
      const callback = await auth.handler(new Request(`https://app.example.test/api/auth/callback/vercel?code=fake-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: stateCookies },
      }));
      assert.equal(callback.status, 302, await callback.clone().text());
      const cookies = callback.headers.getSetCookie()
        .filter((cookie) => !/Max-Age=0(?:;|$)/i.test(cookie))
        .map((cookie) => cookie.split(";", 1)[0]).join("; ");
      const principal = await vercelPrincipal(new Headers({ host: "app.example.test", "x-forwarded-proto": "https", cookie: cookies }));
      assert.ok(principal, `Callback did not create a valid principal: ${callback.headers.get("location")}`);
      return principal;
    }
    const first = await signIn();
    const second = await signIn();
    assert.equal(first.id, second.id);
    assert.ok(first.id.startsWith("vercel:"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel sign-in refuses a host outside the configured origin", async () => {
  await assert.rejects(auth.handler(new Request("https://untrusted.example.test/api/auth/sign-in/social", {
    method: "POST", headers: { origin: "https://untrusted.example.test", "content-type": "application/json" },
    body: JSON.stringify({ provider: "vercel", callbackURL: "/" }),
  })), /not in the allowed hosts list/);
});
