import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__tflashWorkspacePrincipal(); }", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: "data:text/javascript,export async function serverSupabase() { return globalThis.__tflashWorkspaceSupabase(); }", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const route = await import("../app/api/workspace/route.ts");
const { emptyWorkspace } = await import("../lib/workspace.ts");
let principal = null;
const rows = new Map();
let failDatabase = false;
globalThis.__tflashWorkspacePrincipal = () => principal;
class Query {
  constructor() { this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  maybeSingle() { return Promise.resolve(this.execute(true)); }
  async upsert(row) {
    if (failDatabase) return { error: { message: "database unavailable" } };
    rows.set(row.user_id, row);
    return { error: null };
  }
  execute(single = false) {
    if (failDatabase) return { data: null, error: { message: "database unavailable" } };
    const found = [...rows.values()].filter((row) => this.filters.every((filter) => filter(row)));
    return { data: single ? found[0] ?? null : found, error: null };
  }
}
globalThis.__tflashWorkspaceSupabase = async () => ({ from: () => new Query() });
const request = (body, headers = {}) => new Request("https://tflash.example.test/api/workspace", {
  method: "PUT", headers: { "content-type": "application/json", ...headers }, body,
});
afterEach(() => { principal = null; rows.clear(); failDatabase = false; });

test("workspace API requires a verified principal and keeps Vercel identities browser-local", async () => {
  assert.equal((await route.GET()).status, 401);
  principal = { id: "vercel:user", kind: "vercel" };
  assert.equal((await route.GET()).status, 200);
  assert.equal((await (await route.GET()).json()).storage, "browser");
  assert.equal((await route.PUT(request(JSON.stringify(emptyWorkspace())))).status, 200);
  assert.equal(rows.size, 0);
});

test("Supabase workspace reads, validates, and upserts only the authenticated user row", async () => {
  principal = { id: "user-a", kind: "supabase" };
  const empty = emptyWorkspace();
  assert.deepEqual(await (await route.GET()).json(), { storage: "cloud", workspace: null });
  assert.equal((await route.PUT(request(JSON.stringify(empty)))).status, 200);
  assert.deepEqual(rows.get("user-a").workspace, empty);
  assert.deepEqual((await (await route.GET()).json()).workspace, empty);
  assert.equal(rows.has("user-b"), false);
  assert.equal((await route.PUT(request(JSON.stringify({ ...empty, maxSteps: 999 })))).status, 400);
  assert.equal((await route.PUT(request("{bad json"))).status, 400);
  assert.equal((await route.PUT(request("x".repeat(200001)))).status, 413);
  assert.equal((await route.PUT(request(JSON.stringify(empty), { "content-type": "text/plain" }))).status, 415);
});

test("database failures and corrupt stored workspaces fail without overwriting data", async () => {
  principal = { id: "user-a", kind: "supabase" };
  rows.set("user-a", { user_id: "user-a", workspace: { invalid: true } });
  assert.equal((await route.GET()).status, 503);
  failDatabase = true;
  assert.equal((await route.GET()).status, 503);
  assert.equal((await route.PUT(request(JSON.stringify(emptyWorkspace())))).status, 503);
  assert.deepEqual(rows.get("user-a").workspace, { invalid: true });
});