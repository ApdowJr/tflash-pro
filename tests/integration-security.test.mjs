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
