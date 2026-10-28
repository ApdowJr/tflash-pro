import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Run real integration and OAuth handlers with a fake signed-in user and provider.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__integrationPrincipal; }", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  if ((context.parentURL?.includes("/lib/integrations/") || context.parentURL?.includes("/app/api/integrations/oauth/")) && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
}});
process.env.NODE_ENV = "production";
process.env.PROVIDER_KEYS_SECRET = "integration-test-secret-not-production-0123456789";
process.env.GITHUB_OAUTH_CLIENT_ID = "test-client";
process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_URL = "https://app.example.test";
const { sealIntegrationToken, openIntegrationToken, integrationTokenFor } = await import("../lib/integrations/credentials.ts");
const { ATTR_INTEGRATION_TOKENS } = await import("../lib/integrations/wire.ts");
const start = await import("../app/api/integrations/oauth/start/route.ts");
const callback = await import("../app/api/integrations/oauth/callback/route.ts");
const result = await import("../app/api/integrations/oauth/result/route.ts");
const connect = await import("../app/api/integrations/connect/route.ts");
const refresh = await import("../app/api/integrations/oauth/refresh/route.ts");
const status = await import("../app/api/integrations/route.ts");

const userA = { id: "user-a", kind: "supabase", email: "a@example.test", name: "A" };
const userB = { id: "user-b", kind: "supabase", email: "b@example.test", name: "B" };
const headers = { host: "app.example.test", "x-forwarded-proto": "https" };
const cookiePair = (cookie) => cookie.split(";")[0];

test("integration credentials are encrypted and bound to their account", async () => {
  const { token } = await sealIntegrationToken({ integrationId: "github", ownerId: "user-a", token: "private-token" });
  assert.ok(!token.includes("private-token"));
  assert.equal((await openIntegrationToken(token, "user-a"))?.token, "private-token");
  assert.equal(await openIntegrationToken(token, "user-b"), null);
  const attrs = { [ATTR_INTEGRATION_TOKENS]: JSON.stringify([token]) };
  assert.equal(await integrationTokenFor("github", attrs, "user-a"), "private-token");
  assert.equal(await integrationTokenFor("github", attrs, "user-b"), undefined);
  assert.equal(await integrationTokenFor("github", attrs, undefined), undefined);
});

test("integration OAuth state is tied to the signed-in user, browser and trusted origin", async () => {
  globalThis.__integrationPrincipal = userA;
  const initial = await start.GET(new Request("https://app.example.test/api/integrations/oauth/start?id=github", { headers }));
  assert.equal(initial.status, 302);
  const authorizeUrl = new URL(initial.headers.get("location"));
  assert.equal(authorizeUrl.hostname, "github.com");
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://app.example.test/api/integrations/oauth/callback");
  const state = authorizeUrl.searchParams.get("state");
  const flowCookie = cookiePair(initial.headers.getSetCookie()[0]);
  const callbackURL = `https://app.example.test/api/integrations/oauth/callback?code=sample-code&state=${encodeURIComponent(state)}`;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(String(url), "https://github.com/login/oauth/access_token");
    assert.equal(options.redirect, "error");
    assert.ok(String(options.body).includes("sample-code"));
    return Response.json({ access_token: "test-github-access", token_type: "bearer" });
  };
  try {
    assert.match((await callback.GET(new Request(callbackURL, { headers }))).headers.get("location"), /oauth=state/);
    globalThis.__integrationPrincipal = userB;
    assert.match((await callback.GET(new Request(callbackURL, { headers: { ...headers, cookie: flowCookie } }))).headers.get("location"), /oauth=state/);
    assert.equal(calls, 0);
    globalThis.__integrationPrincipal = userA;
    const completed = await callback.GET(new Request(callbackURL, { headers: { ...headers, cookie: flowCookie } }));
    assert.match(completed.headers.get("location"), /connected=1/);
    assert.equal(calls, 1);
    const responseCookies = completed.headers.getSetCookie();
    const handoff = responseCookies.find((entry) => entry.startsWith("tflash-oauth-handoff="));
    assert.ok(handoff);
    assert.ok(responseCookies.some((entry) => entry.includes("Max-Age=0")));
    globalThis.__integrationPrincipal = userB;
    const foreign = await result.GET(new Request("https://app.example.test/api/integrations/oauth/result", { headers: { ...headers, cookie: cookiePair(handoff) } }));
    assert.equal((await foreign.json()).connected, false);
    globalThis.__integrationPrincipal = userA;
    const final = await result.GET(new Request("https://app.example.test/api/integrations/oauth/result", { headers: { ...headers, cookie: cookiePair(handoff) } }));
    const payload = await final.json();
    assert.equal(payload.connected, true);
    assert.equal((await openIntegrationToken(payload.token, userA.id))?.token, "test-github-access");
    assert.equal(await openIntegrationToken(payload.token, userB.id), null);
    const forgedHost = await start.GET(new Request("https://app.example.test/api/integrations/oauth/start?id=github", { headers: { host: "evil.example", "x-forwarded-proto": "https" } }));
    assert.match(forgedHost.headers.get("location"), /^\/\?integration=github&oauth=misconfigured$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("integration mutation endpoints require a session and JSON", async () => {
  globalThis.__integrationPrincipal = null;
  assert.equal((await connect.POST(new Request("https://app.example.test/api/integrations/connect", { method: "POST" }))).status, 401);
  assert.equal((await refresh.POST(new Request("https://app.example.test/api/integrations/oauth/refresh", { method: "POST" }))).status, 401);
  globalThis.__integrationPrincipal = userA;
  assert.equal((await connect.POST(new Request("https://app.example.test/api/integrations/connect", { method: "POST" }))).status, 415);
  assert.equal((await refresh.POST(new Request("https://app.example.test/api/integrations/oauth/refresh", { method: "POST" }))).status, 415);
});

test("inconclusive integration probes require an explicit unverified save", async () => {
  globalThis.__integrationPrincipal = userA;
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  const request = (force = false) => new Request("https://app.example.test/api/integrations/connect", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ integrationId: "github", token: "fake-token", force }),
  });
  try {
    const unverified = await connect.POST(request());
    assert.equal(unverified.status, 502);
    assert.equal((await unverified.json()).canForce, true);
    const forced = await connect.POST(request(true));
    const payload = await forced.json();
    assert.equal(forced.status, 200);
    assert.equal(payload.verified, false);
    assert.match(payload.message, /without a live check/);
  } finally {
    globalThis.fetch = original;
  }
});


test("project fallback is not reported as a verified/configured integration", async () => {
  globalThis.__integrationPrincipal = userA;
  process.env.VERCEL_PROJECT_ID = "test-project";
  delete process.env.CONNECT_GITHUB_CONNECTOR;
  delete process.env.GITHUB_MCP_TOKEN;
  delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  try {
    const response = await status.GET();
    const body = await response.json();
    const github = body.integrations.find((item) => item.id === "github");
    assert.equal(github.mode, "project-connect");
    assert.equal(github.configured, false);
    process.env.CONNECT_GITHUB_CONNECTOR = "github/test-connector";
    const explicit = (await (await status.GET()).json()).integrations.find((item) => item.id === "github");
    assert.equal(explicit.mode, "connect");
    assert.equal(explicit.configured, true); // present, not live-verified
  } finally {
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.CONNECT_GITHUB_CONNECTOR;
  }
});

test("all nine MCP OAuth services register, request consent, exchange and refresh without a pasted token", async () => {
  globalThis.__integrationPrincipal = userA;
  const { OAUTH_PROVIDERS, openOAuthState } = await import("../lib/integrations/oauth.ts");
  const originalFetch = globalThis.fetch;
  try {
    for (const [id, provider] of Object.entries(OAUTH_PROVIDERS)) {
      if (!provider.registrationUrl) continue;
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        assert.equal(options.redirect, "error");
        if (String(url) === provider.registrationUrl) {
          const body = JSON.parse(options.body);
          assert.deepEqual(body.redirect_uris, ["https://app.example.test/api/integrations/oauth/callback"]);
          assert.equal(body.client_name, "Tflash");
          assert.equal(body.token_endpoint_auth_method, id === "supabase" ? "client_secret_basic" : "none");
          return Response.json({ client_id: `registered-${id}`, token_endpoint_auth_method: body.token_endpoint_auth_method,
            ...(id === "supabase" ? { client_secret: "registered-private-secret" } : {}) });
        }
        assert.equal(String(url), provider.tokenUrl);
        const body = new URLSearchParams(options.body);
        if (provider.resource) assert.equal(body.get("resource"), provider.resource);
        if (id === "supabase") {
          assert.equal(options.headers.authorization, `Basic ${btoa("registered-supabase:registered-private-secret")}`);
        } else assert.equal(body.get("client_id"), `registered-${id}`);
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("code"), "sample-code");
          assert.match(body.get("code_verifier"), /^[A-Za-z0-9_-]{43}$/);
          return Response.json({ access_token: `access-${id}`, refresh_token: `refresh-${id}`, expires_in: 3600 });
        }
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), `refresh-${id}`);
        return Response.json({ access_token: `new-access-${id}`, refresh_token: `rotated-${id}`, expires_in: 3600 });
      };
      const initial = await start.GET(new Request(`https://app.example.test/api/integrations/oauth/start?id=${id}&returnTo=%2Fs%2Fmy-chat`, { headers }));
      assert.equal(initial.status, 302, id);
      const authorize = new URL(initial.headers.get("location"));
      assert.equal(`${authorize.origin}${authorize.pathname}`, provider.authorizeUrl, id);
      assert.equal(authorize.searchParams.get("client_id"), `registered-${id}`);
      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.match(authorize.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
      assert.ok(!authorize.href.includes("registered-private-secret"));
      const state = authorize.searchParams.get("state");
      assert.equal((await openOAuthState(state)).returnTo, "/s/my-chat");
      const flowCookie = cookiePair(initial.headers.getSetCookie()[0]);
      const completed = await callback.GET(new Request(`https://app.example.test/api/integrations/oauth/callback?code=sample-code&state=${encodeURIComponent(state)}`, { headers: { ...headers, cookie: flowCookie } }));
      assert.equal(completed.headers.get("location"), `/s/my-chat?integration=${id}&connected=1`);
      assert.ok(!completed.headers.get("location").includes("access-"));
      const handoff = completed.headers.getSetCookie().find((cookie) => cookie.startsWith("tflash-oauth-handoff="));
      const payload = await (await result.GET(new Request("https://app.example.test/api/integrations/oauth/result", { headers: { ...headers, cookie: cookiePair(handoff) } }))).json();
      assert.equal(payload.connected, true);
      assert.equal(payload.integrationId, id);
      assert.equal(payload.refreshable, true);
      assert.ok(payload.expiresAt > Date.now() + 29 * 86400000, "grant lifetime must not be truncated to the five-minute handoff lifetime");
      assert.equal(payload.clientSecret, undefined);
      assert.equal(payload.oauthClient, undefined);
      const opened = await openIntegrationToken(payload.token, userA.id);
      assert.equal(opened.token, `access-${id}`);
      assert.equal(opened.oauthClient.clientId, `registered-${id}`);
      assert.equal(await openIntegrationToken(payload.token, userB.id), null);
      const renewed = await refresh.POST(new Request("https://app.example.test/api/integrations/oauth/refresh", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: payload.token }),
      }));
      assert.equal(renewed.status, 200, id);
      const updated = await openIntegrationToken((await renewed.json()).token, userA.id);
      assert.equal(updated.token, `new-access-${id}`);
      assert.equal(updated.refreshToken, `rotated-${id}`);
      assert.equal(updated.oauthClient.clientId, `registered-${id}`);
      assert.equal(calls.length, 3, id);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("registration errors fail closed, untrusted hosts never register, and denial never connects", async () => {
  globalThis.__integrationPrincipal = userA;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ error: "invalid_redirect_uri" }, { status: 400 }); };
  try {
    const request = (extra = "") => new Request(`https://app.example.test/api/integrations/oauth/start?id=linear${extra}`, { headers });
    const failed = await start.GET(request("&returnTo=%2Fs%2Fmy-chat"));
    assert.equal(failed.headers.get("location"), "/s/my-chat?integration=linear&oauth=misconfigured");
    assert.equal(failed.headers.getSetCookie().length, 0);
    await start.GET(new Request("https://app.example.test/api/integrations/oauth/start?id=linear", { headers: { host: "evil.example", "x-forwarded-proto": "https" } }));
    assert.equal(calls, 1, "untrusted origins cannot create vendor clients");
    globalThis.fetch = async () => Response.json({ client_id: "linear-client", token_endpoint_auth_method: "none" });
    const initial = await start.GET(request("&returnTo=https%3A%2F%2Fevil.example"));
    const state = new URL(initial.headers.get("location")).searchParams.get("state");
    const cookie = cookiePair(initial.headers.getSetCookie()[0]);
    globalThis.fetch = async () => { throw new Error("Denial must not exchange a token"); };
    const denied = await callback.GET(new Request(`https://app.example.test/api/integrations/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { ...headers, cookie } }));
    assert.equal(denied.headers.get("location"), "/?integration=linear&oauth=denied");
    assert.ok(!denied.headers.getSetCookie().some((item) => item.startsWith("tflash-oauth-handoff=")));
    assert.ok(denied.headers.getSetCookie()[0].includes("Max-Age=0"));
  } finally { globalThis.fetch = originalFetch; }
});

test("automatic OAuth is available without operator secrets, while GitHub needs a registered app", async () => {
  globalThis.__integrationPrincipal = userA;
  const previousId = process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  try {
    const body = await (await status.GET()).json();
    for (const item of body.integrations) {
      assert.equal(item.oauthAvailable, item.id !== "github", item.id);
      assert.equal(item.configured, false, "OAuth availability alone is not an authorized connection");
    }
  } finally { process.env.GITHUB_OAUTH_CLIENT_ID = previousId; }
});

test("earlier REST OAuth grants can still renew with their original client", async () => {
  globalThis.__integrationPrincipal = userA;
  process.env.LINEAR_OAUTH_CLIENT_ID = "legacy-linear-client";
  process.env.LINEAR_OAUTH_CLIENT_SECRET = "legacy-linear-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.linear.app/oauth/token");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("client_id"), "legacy-linear-client");
    assert.equal(body.get("client_secret"), "legacy-linear-secret");
    assert.equal(body.get("resource"), null);
    return Response.json({ access_token: "renewed-legacy-token", refresh_token: "new-refresh", expires_in: 3600 });
  };
  try {
    const sealed = await sealIntegrationToken({ integrationId: "linear", ownerId: userA.id, token: "legacy-token", refreshToken: "legacy-refresh" });
    const response = await refresh.POST(new Request("https://app.example.test/api/integrations/oauth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: sealed.token }) }));
    assert.equal(response.status, 200);
    assert.equal((await openIntegrationToken((await response.json()).token, userA.id)).token, "renewed-legacy-token");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LINEAR_OAUTH_CLIENT_ID;
    delete process.env.LINEAR_OAUTH_CLIENT_SECRET;
  }
});
