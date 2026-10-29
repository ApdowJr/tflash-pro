import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const variables = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TFLASH_SUPABASE_URL", "NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY",
];
function readConfig(input = {}) {
  const env = { ...process.env };
  for (const name of variables) delete env[name];
  Object.assign(env, input);
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { supabaseUrl, supabasePublishableKey } from './lib/supabase/config.ts';
    console.log(JSON.stringify({ url: supabaseUrl, key: supabasePublishableKey }));
  `], { cwd: new URL("..", import.meta.url), env, encoding: "utf8" });
}
function values(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Supabase configuration uses the existing default or complete standard pair", () => {
  assert.deepEqual(values(readConfig()), {
    url: "https://uatpsywxzdkdjhbclzve.supabase.co", key: "sb_publishable_kLQJ82DtLOu3XjNecH6Qpw_fvVRCOy6",
  });
  assert.deepEqual(values(readConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://standard.example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "standard-key",
  })), { url: "https://standard.example.test", key: "standard-key" });
});

test("a complete Tflash override pair wins over integration-managed project values", () => {
  assert.deepEqual(values(readConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://integration.example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "integration-key",
    NEXT_PUBLIC_TFLASH_SUPABASE_URL: "https://override.example.test", NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY: "override-key",
  })), { url: "https://override.example.test", key: "override-key" });
});

test("incomplete URL/key pairs fail closed instead of mixing projects", () => {
  for (const input of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://standard.example.test" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "standard-key" },
    { NEXT_PUBLIC_TFLASH_SUPABASE_URL: "https://override.example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "other-key" },
    { NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY: "override-key", NEXT_PUBLIC_SUPABASE_URL: "https://other.example.test" },
  ]) {
    const result = readConfig(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Configure both NEXT_PUBLIC_/);
  }
});
