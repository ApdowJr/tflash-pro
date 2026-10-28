import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Import the real Next route while replacing only its server-side Supabase client.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase/server") {
      return { url: "data:text/javascript,export async function serverSupabase() { return globalThis.__tflashMockSupabase(); }", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../app/auth/callback/route.ts");

function request(query) {
  // The private listener address must never become the browser redirect origin.
  return new Request(`http://0.0.0.0:3000/auth/callback${query}`);
}

test("callback uses the matching PKCE flow and a relative, no-store redirect", async () => {
  const calls = [];
  globalThis.__tflashMockSupabase = async () => ({ auth: { exchangeCodeForSession: async (...args) => { calls.push(args); return { error: null }; } } });
  const response = await GET(request("?code=test-code&next=%2Fauth%2Freset-password&sb_flow_id=flow123456"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/auth/reset-password");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [["test-code", { flowId: "flow123456" }]]);
});

test("callback rejects unsafe redirect destinations and supports older links", async () => {
  const calls = [];
  globalThis.__tflashMockSupabase = async () => ({ auth: { exchangeCodeForSession: async (...args) => { calls.push(args); return { error: null }; } } });
  const response = await GET(request("?code=test-code&next=%2F%2Fevil.example"));
  assert.equal(response.headers.get("location"), "/");
  assert.deepEqual(calls, [["test-code", undefined]]);
});

test("invalid links and Auth service failures return to login without exposing errors", async () => {
  globalThis.__tflashMockSupabase = async () => ({ auth: { exchangeCodeForSession: async () => { throw new Error("internal details"); } } });
  for (const query of ["", "?code=broken"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/login?error=auth_link");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  }
});
