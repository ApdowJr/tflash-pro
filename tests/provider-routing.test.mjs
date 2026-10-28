import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { generateText } from "ai";

// The app uses extensionless TypeScript imports for Next's bundler. Resolve
// only its local provider modules for Node's built-in TypeScript stripping.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/lib/providers/") && /^\.\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { resolveLanguageModel } = await import("../lib/providers/runtime.ts");
const { credentialFromInput } = await import("../lib/providers/route-helpers.ts");
const { sealCredential } = await import("../lib/providers/credentials.ts");
const { getProvider } = await import("../lib/providers/catalog.ts");

process.env.NODE_ENV = "production";
process.env.TFLASH_SESSION_SECRET = "local-test-secret-only-0123456789abcdef";
process.env.OPENROUTER_API_KEY = "openrouter-test-key";
process.env.CUSTOM_PROVIDER_ALLOWED_HOSTS = "local-model.example.test";
process.env.OLLAMA_BASE_URL = "https://local-model.example.test/v1";

test("an empty endpoint field uses the configured local provider URL", async () => {
  const credential = await credentialFromInput(getProvider("ollama"), { baseURL: "" });
  assert.equal(credential.baseURL, "https://local-model.example.test/v1");
});

test("switching providers routes actual SDK requests to the chosen endpoint and model", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body), redirect: init.redirect });
    return Response.json({
      id: "test-completion", object: "chat.completion", created: 1, model: "test",
      choices: [{ index: 0, message: { role: "assistant", content: "Mock response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    });
  };
  try {
    for (const [providerId, modelId] of [["openrouter", "openai/gpt-4o-mini"], ["ollama", "llama3.2"]]) {
      const { model } = await resolveLanguageModel({ providerId, modelId, contextWindow: 128000 });
      const result = await generateText({ model, prompt: "Hello" });
      assert.equal(result.text, "Mock response");
    }
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].body.model, "openai/gpt-4o-mini");
    assert.equal(calls[0].headers.get("authorization"), "Bearer openrouter-test-key");
    assert.equal(calls[1].url, "https://local-model.example.test/v1/chat/completions");
    assert.equal(calls[1].body.model, "llama3.2");
    assert.equal(calls[1].redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("another account cannot use a saved provider key or fall back silently", async () => {
  const { token } = await sealCredential({ providerId: "openrouter", ownerId: "owner-a", apiKey: "private-test-key" });
  const provider = getProvider("openrouter");
  assert.equal((await credentialFromInput(provider, { token }, { ownerId: "owner-a" })).apiKey, "private-test-key");
  await assert.rejects(credentialFromInput(provider, { token }, { ownerId: "owner-b" }), /belongs to another account/);
  await assert.rejects(resolveLanguageModel({ providerId: "openrouter", modelId: "test", contextWindow: 128000, token }, "owner-b"), /belongs to another account/);
});
