import test from "node:test";
import assert from "node:assert/strict";
import {
  signChatCreation,
  signChatOwnership,
  verifyChatCreation,
  verifyChatOwnership,
} from "../lib/security/chat-ownership.ts";
import {
  approvedBaseURL,
  openCredential,
  resolveCredential,
  sealCredential,
} from "../lib/providers/credentials.ts";
import { fetchLiveModels } from "../lib/providers/live-models.ts";
import { safeLocalPath } from "../lib/security/redirect.ts";
import { internalEveHeaders, internalOrigin } from "../lib/security/internal-origin.ts";

// Tests are local and never require real Supabase or provider credentials.
process.env.NODE_ENV = "production";
process.env.TFLASH_SESSION_SECRET = "local-test-secret-only-0123456789abcdef";
process.env.PROVIDER_KEYS_SECRET = "local-test-provider-key-0123456789abcdef";

test("authentication redirects remain on the same origin", () => {
  assert.equal(safeLocalPath("/s/example?tab=1"), "/s/example?tab=1");
  for (const value of ["//evil.example", "/\\\\evil.example", "https://evil.example", "/path\r\nheader: bad", ""]) {
    assert.equal(safeLocalPath(value), "/");
  }
});

test("internal Eve requests use a trusted HTTPS origin and only the server's protection bypass", () => {
  const previousOrigin = process.env.TFLASH_INTERNAL_ORIGIN;
  const previousBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    process.env.TFLASH_INTERNAL_ORIGIN = "https://trusted.example/internal";
    assert.equal(internalOrigin(), "https://trusted.example");
    process.env.TFLASH_INTERNAL_ORIGIN = "http://trusted.example";
    assert.throws(() => internalOrigin(), /must use HTTPS/);

    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    assert.equal(internalEveHeaders({ "x-vercel-protection-bypass": "client-supplied" }).has("x-vercel-protection-bypass"), false);
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "test-only-bypass";
    const headers = internalEveHeaders({ cookie: "test-cookie", "x-vercel-protection-bypass": "client-supplied" });
    assert.equal(headers.get("cookie"), "test-cookie");
    assert.equal(headers.get("x-vercel-protection-bypass"), "test-only-bypass");
  } finally {
    if (previousOrigin === undefined) delete process.env.TFLASH_INTERNAL_ORIGIN;
    else process.env.TFLASH_INTERNAL_ORIGIN = previousOrigin;
    if (previousBypass === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = previousBypass;
  }
});

test("ownership proof binds both account and conversation", () => {
  const proof = signChatOwnership("alice", "session-a");
  assert.equal(verifyChatOwnership("alice", "session-a", proof), true);
  assert.equal(verifyChatOwnership("bob", "session-a", proof), false);
  assert.equal(verifyChatOwnership("alice", "session-b", proof), false);
  assert.equal(verifyChatOwnership("alice", "session-a", `${proof}x`), false);
});

test("creation proof is short-lived, scoped, and cannot be modified", () => {
  const now = 1_800_000_000_000;
  const proof = signChatCreation("alice", now);
  assert.equal(verifyChatCreation("alice", proof, now + 59_000), true);
  assert.equal(verifyChatCreation("alice", proof, now + 61_000), false);
  assert.equal(verifyChatCreation("bob", proof, now), false);
  assert.equal(verifyChatCreation("alice", `${proof}.extra`, now), false);
});

test("production custom endpoints require an exact host allowlist", () => {
  const local = { customBaseURL: true, baseURL: "http://localhost:11434/v1" };
  const fixed = { customBaseURL: false, baseURL: "https://openrouter.ai/api/v1" };
  process.env.CUSTOM_PROVIDER_ALLOWED_HOSTS = "api.example.test,localhost:11434";
  assert.equal(approvedBaseURL("https://api.example.test/v1", local), "https://api.example.test/v1");
  assert.equal(approvedBaseURL("http://localhost:11434/v1", local), "http://localhost:11434/v1");
  assert.equal(approvedBaseURL("https://api.example.test.evil/v1", local), null);
  assert.equal(approvedBaseURL("https://169.254.169.254/v1", local), null);
  assert.equal(approvedBaseURL("http://api.example.test/v1", local), null);
  assert.equal(approvedBaseURL(fixed.baseURL, fixed), fixed.baseURL);
  assert.equal(approvedBaseURL("https://elsewhere.example/v1", fixed), null);
  delete process.env.CUSTOM_PROVIDER_ALLOWED_HOSTS;
  assert.equal(approvedBaseURL(local.baseURL, local), null);
});

test("model discovery refuses endpoint redirects", async () => {
  const originalFetch = globalThis.fetch;
  let redirectMode;
  globalThis.fetch = async (_url, init) => {
    redirectMode = init.redirect;
    return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await fetchLiveModels(
      { name: "Test", kind: "openai-compatible", modelsPath: "/models", models: [] },
      { baseURL: "https://api.example.test/v1", apiKey: "", source: "none" },
    );
    assert.equal(result.ok, true);
    assert.equal(redirectMode, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider keys are sealed and tampering is rejected", async () => {
  const key = "a-private-test-provider-key";
  const { token, expiresAt } = await sealCredential({ providerId: "openrouter", apiKey: key });
  assert.equal(token.includes(key), false);
  assert.ok(expiresAt > Date.now());
  assert.equal((await openCredential(token))?.apiKey, key);
  const parts = token.split(".");
  // Flip a character in the authenticated ciphertext (not the padding bits).
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.equal(await openCredential(parts.join(".")), null);
});

test("a remembered custom URL can use a server key without sealing that key", async () => {
  const provider = {
    id: "custom", kind: "openai-compatible", customBaseURL: true,
    baseURL: "https://default.example.test/v1", envKey: "CUSTOM_PROVIDER_API_KEY",
  };
  process.env.CUSTOM_PROVIDER_ALLOWED_HOSTS = "custom.example.test";
  process.env.CUSTOM_PROVIDER_API_KEY = "operator-only-key";
  try {
    const { token } = await sealCredential({
      providerId: "custom", apiKey: "", baseURL: "https://custom.example.test/v1",
    });
    assert.equal((await openCredential(token))?.apiKey, "");
    const resolved = await resolveCredential(provider, token);
    assert.equal(resolved.apiKey, "operator-only-key");
    assert.equal(resolved.baseURL, "https://custom.example.test/v1");
    assert.equal(resolved.source, "environment");
  } finally {
    delete process.env.CUSTOM_PROVIDER_ALLOWED_HOSTS;
    delete process.env.CUSTOM_PROVIDER_API_KEY;
  }
});

test("production rejects a weak provider encryption secret", async () => {
  const previous = process.env.PROVIDER_KEYS_SECRET;
  process.env.PROVIDER_KEYS_SECRET = "too-short";
  try {
    await assert.rejects(
      sealCredential({ providerId: "openrouter", apiKey: "test" }),
      /at least 32 characters/,
    );
  } finally {
    process.env.PROVIDER_KEYS_SECRET = previous;
  }
});
