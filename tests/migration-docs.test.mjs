import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const readmeUrl = new URL("../README.md", import.meta.url);
const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const readme = readFileSync(readmeUrl, "utf8");

test("Supabase setup instructions reference every committed migration in version order", () => {
  const references = [...readme.matchAll(/`(supabase\/migrations\/[^`]+\.sql)`/g)].map((match) => match[1]);
  const migrations = readdirSync(migrationsUrl)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => `supabase/migrations/${file}`)
    .sort();

  assert.deepEqual(references, migrations);
  for (const reference of references) {
    assert.ok(existsSync(new URL(`../${reference}`, import.meta.url)), `Missing migration: ${reference}`);
  }
});
