import test from "node:test";
import assert from "node:assert/strict";
import { deploymentSecret } from "../lib/security/deployment-secrets.mjs";

// Each test file is a separate Node process; these are deliberately dummy values.
process.env.NODE_ENV = "production";
delete process.env.TFLASH_SESSION_SECRET;
delete process.env.PROVIDER_KEYS_SECRET;
process.env.BETTER_AUTH_SECRET = "only-a-fake-better-auth-secret-0123456789abcdef";
process.env.VERCEL_GIT_COMMIT_REF = "arena/test-branch";

test("preview secret derivation is explicitly enabled and isolated by branch and purpose", () => {
  process.env.VERCEL_ENV = "preview";
  delete process.env.TFLASH_PREVIEW_USE_AUTH_SECRET;
  assert.equal(deploymentSecret("session"), undefined);
  process.env.TFLASH_PREVIEW_USE_AUTH_SECRET = "1";
  const session = deploymentSecret("session");
  const credentials = deploymentSecret("credentials");
  assert.equal(session?.length, 64);
  assert.notEqual(session, credentials);
  assert.equal(deploymentSecret("session"), session);
  process.env.VERCEL_GIT_COMMIT_REF = "arena/other-branch";
  assert.notEqual(deploymentSecret("session"), session);
  delete process.env.VERCEL_GIT_COMMIT_REF;
  assert.equal(deploymentSecret("session"), undefined);
  process.env.VERCEL_GIT_COMMIT_REF = "arena/test-branch";
  process.env.BETTER_AUTH_SECRET = "short";
  assert.equal(deploymentSecret("session"), undefined);
});

test("production never uses the preview-only fallback", () => {
  process.env.BETTER_AUTH_SECRET = "only-a-fake-better-auth-secret-0123456789abcdef";
  process.env.VERCEL_ENV = "production";
  process.env.TFLASH_PREVIEW_USE_AUTH_SECRET = "1";
  assert.equal(deploymentSecret("session"), undefined);
  assert.equal(deploymentSecret("credentials"), undefined);
  process.env.TFLASH_SESSION_SECRET = "explicit-session-secret-not-real-0123456789";
  process.env.PROVIDER_KEYS_SECRET = "explicit-provider-secret-not-real-0123456789";
  assert.equal(deploymentSecret("session"), process.env.TFLASH_SESSION_SECRET);
  assert.equal(deploymentSecret("credentials"), process.env.PROVIDER_KEYS_SECRET);
});
