import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal(){ return globalThis.__catalogPrincipal; }", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  if (context.parentURL?.startsWith(new URL("../", import.meta.url).href) && !context.parentURL.includes("/node_modules/") && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { fetchCatalogJson } = await import("../lib/catalog-fetch.ts");
const { fetchLiveModels } = await import("../lib/providers/live-models.ts");
const { getProvider } = await import("../lib/providers/catalog.ts");
const modelsRoute = await import("../app/api/providers/models/route.ts");
const providersRoute = await import("../app/api/providers/route.ts");
const integrationsRoute = await import("../app/api/integrations/route.ts");
const testRoute = await import("../app/api/providers/test/route.ts");
const connectRoute = await import("../app/api/providers/connect/route.ts");
const originalFetch = globalThis.fetch;
process.env.TFLASH_SESSION_SECRET = "local-test-session-secret-0123456789abcdef";
process.env.PROVIDER_KEYS_SECRET = "local-test-provider-secret-0123456789abcdef";
globalThis.__catalogPrincipal = { id: "alice", kind: "vercel" };
afterEach(() => { globalThis.fetch = originalFetch; });
const provider = getProvider("ollama");
const credential = { baseURL: "https://example.test/v1", apiKey: "secret-key", source: "browser", label: "test" };
const jsonPost = (path, payload, headers = {}) => new Request(`https://tflash.example.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });

test("catalog timeouts ignore uncooperative transport and cancel a late response", async () => {
  let resolve, cancelled = false;
  globalThis.fetch = () => new Promise((r) => { resolve = r; });
  const pending = fetchCatalogJson("https://example.test", {}, 15);
  await assert.rejects(pending);
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cancelled, true);
});

test("catalog bounds stalled bodies and byte counts", async () => {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }));
  await assert.rejects(fetchCatalogJson("https://example.test", {}, 15));
  assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response("123456789");
  await assert.rejects(fetchCatalogJson("https://example.test", {}, 1000, 4), /large/);
});

test("model discovery validates payload, labels empty lists and suppresses transport secrets", async () => {
  globalThis.fetch = async () => Response.json({ models: [] });
  let result = await fetchLiveModels(provider, credential);
  assert.equal(result.ok, true); assert.equal(result.source, "static"); assert.match(result.error, /not verified/);
  globalThis.fetch = async () => Response.json({ wrong: [] });
  result = await fetchLiveModels(provider, credential);
  assert.equal(result.ok, false); assert.equal(result.source, "static");
  globalThis.fetch = async () => { throw new Error("secret-key https://example.test/?key=secret-key"); };
  result = await fetchLiveModels(provider, credential);
  assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /secret-key|example\.test/);
  globalThis.fetch = async () => Response.json({ data: [{ id: "valid:model" }, { id: "bad?key=secret-key" }, { id: "valid:model" }] });
  result = await fetchLiveModels(provider, credential);
  assert.deepEqual(result.models.map((item) => item.id), ["valid:model"]);
});

test("account-bound catalog and connection routes reject mismatches before probing", async () => {
  let probes = 0; globalThis.fetch = async () => { probes++; return Response.json({ data: [] }); };
  const headers = { "x-tflash-expected-user-id": "bob", "x-tflash-expected-account-kind": "vercel" };
  for (const [route, url] of [[providersRoute, "/api/providers"], [integrationsRoute, "/api/integrations"], [modelsRoute, "/api/providers/models?provider=ollama"]]) {
    assert.equal((await route.GET(new Request(`https://tflash.example.test${url}`, { headers }))).status, 409);
  }
  for (const [route, path] of [[testRoute, "/api/providers/test"], [connectRoute, "/api/providers/connect"]]) {
    assert.equal((await route.POST(jsonPost(path, { providerId: "ollama" }, headers))).status, 409);
  }
  assert.equal(probes, 0);
});

test("connection tests and forced saves do not count fallback models as verified", async () => {
  globalThis.fetch = async () => Response.json({ data: [] });
  let response = await testRoute.POST(jsonPost("/api/providers/test", { providerId: "ollama" }));
  let data = await response.json();
  assert.equal(data.ok, true); assert.equal(data.modelCount, 0); assert.deepEqual(data.sample, []); assert.match(data.message, /not verified/);
  response = await connectRoute.POST(jsonPost("/api/providers/connect", { providerId: "ollama" }));
  data = await response.json(); assert.equal(data.ok, true); assert.equal(data.modelCount, 0); assert.match(data.message, /not verified/);
  globalThis.fetch = async () => new Response("bad", { status: 503 });
  response = await connectRoute.POST(jsonPost("/api/providers/connect", { providerId: "ollama", force: true }));
  data = await response.json(); assert.equal(data.ok, true); assert.equal(data.modelCount, 0); assert.match(data.message, /without verification/);
});
