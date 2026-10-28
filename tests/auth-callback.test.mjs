import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Import the real Next route while replacing only its staged Supabase client.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase/callback") {
      return { url: "data:text/javascript,export async function callbackSupabase() { return globalThis.__tflashMockCallback(); }", shortCircuit: true };
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

function stagedResult({ redirectType = null, signOutThrows = false, session = {} } = {}) {
  const calls = [];
  return {
    calls,
    value: {
      supabase: { auth: {
        exchangeCodeForSession: async (...args) => {
          calls.push(["exchange", ...args]);
          return { data: { session, redirectType }, error: null };
        },
        signOut: async (...args) => {
          calls.push(["signOut", ...args]);
          if (signOutThrows) throw new Error("offline");
          return { error: null };
        },
      } },
      commitRecovery: async () => calls.push(["recovery"]),
      commitVerifiers: async () => calls.push(["verifiers"]),
    },
  };
}

test("a recovery link keeps its session only for the reset-password page", async () => {
  const staged = stagedResult({ redirectType: "recovery" });
  globalThis.__tflashMockCallback = async () => staged.value;
  const response = await GET(request("?code=recovery-code&next=%2F%2Fevil.example&sb_flow_id=flow123456"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/auth/reset-password");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(staged.calls, [["exchange", "recovery-code", { flowId: "flow123456" }], ["recovery"]]);
});

test("a legacy signup link confirms email but returns to password sign-in", async () => {
  const staged = stagedResult();
  globalThis.__tflashMockCallback = async () => staged.value;
  const response = await GET(request("?code=signup-code&next=%2Fsettings%3Ftab%3Dmodels&sb_flow_id=flow123456"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?confirmed=1&next=%2Fsettings%3Ftab%3Dmodels");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(staged.calls, [["exchange", "signup-code", { flowId: "flow123456" }], ["verifiers"], ["signOut", { scope: "local" }]]);
});

test("old links reject unsafe destinations and do not retain a signup session if logout fails", async () => {
  const staged = stagedResult({ signOutThrows: true });
  globalThis.__tflashMockCallback = async () => staged.value;
  const response = await GET(request("?code=old-code&next=%2F%2Fevil.example"));
  assert.equal(response.headers.get("location"), "/login?confirmed=1");
  assert.deepEqual(staged.calls, [["exchange", "old-code", undefined], ["verifiers"], ["signOut", { scope: "local" }]]);
});

test("a signup link cannot become recovery just by changing the redirect destination", async () => {
  const staged = stagedResult();
  globalThis.__tflashMockCallback = async () => staged.value;
  const response = await GET(request("?code=signup-code&next=%2Fauth%2Freset-password"));
  assert.equal(response.headers.get("location"), "/login?confirmed=1&next=%2Fauth%2Freset-password");
  assert.deepEqual(staged.calls, [["exchange", "signup-code", undefined], ["verifiers"], ["signOut", { scope: "local" }]]);
});

test("invalid links, missing sessions, and Auth failures return to login without exposing errors", async () => {
  globalThis.__tflashMockCallback = async () => { throw new Error("internal details"); };
  for (const query of ["", "?code=broken"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/login?error=auth_link");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  }
  const staged = stagedResult({ session: null });
  globalThis.__tflashMockCallback = async () => staged.value;
  const response = await GET(request("?code=missing-session"));
  assert.equal(response.headers.get("location"), "/login?error=auth_link");
  assert.deepEqual(staged.calls, [["exchange", "missing-session", undefined]]);
});
