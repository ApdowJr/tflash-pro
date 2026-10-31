import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "@/lib/identity") return { url: "data:text/javascript,export async function currentPrincipal() { return globalThis.__tflashWorkspacePrincipal(); }", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: "data:text/javascript,export async function serverSupabase() { return globalThis.__tflashWorkspaceSupabase(); }", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const route = await import("../app/api/workspace/route.ts");
const { emptyWorkspace } = await import("../lib/workspace.ts");
const expectedUserHeader = "x-tflash-expected-user-id";
let principal = null;
const rows = new Map();
let failDatabase = false;
globalThis.__tflashWorkspacePrincipal = () => principal;
class Query {
  constructor() { this.filters = []; this.updateValues = null; }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  update(values) { this.updateValues = values; return this; }
  async insert(row) {
    if (failDatabase) return { error: { message: "database unavailable" } };
    if (rows.has(row.user_id)) return { error: { code: "23505", message: "duplicate row" } };
    rows.set(row.user_id, row);
    return { error: null };
  }
  async maybeSingle() {
    if (failDatabase) return { data: null, error: { message: "database unavailable" } };
    const row = [...rows.values()].find((item) => this.filters.every((filter) => filter(item)));
    if (!row) return { data: null, error: null };
    if (this.updateValues) {
      Object.assign(row, this.updateValues);
      return { data: { updated_at: row.updated_at }, error: null };
    }
    return { data: row, error: null };
  }
}
globalThis.__tflashWorkspaceSupabase = async () => ({ from: () => new Query() });
const getRequest = (expectedUserId = principal?.id) => {
  const headers = expectedUserId === undefined || expectedUserId === null
    ? {}
    : { [expectedUserHeader]: expectedUserId };
  return new Request("https://tflash.example.test/api/workspace", { headers });
};
const putRequest = (body, { expectedUserId = principal?.id, contentType = "application/json" } = {}) => {
  const headers = { "content-type": contentType };
  if (expectedUserId !== undefined && expectedUserId !== null) headers[expectedUserHeader] = expectedUserId;
  return new Request("https://tflash.example.test/api/workspace", { method: "PUT", headers, body });
};
const putWorkspace = (workspace, expectedUpdatedAt = null, options) =>
  putRequest(JSON.stringify({ workspace, expectedUpdatedAt }), options);
afterEach(() => { principal = null; rows.clear(); failDatabase = false; });

test("workspace API requires a verified principal and keeps Vercel identities browser-local", async () => {
  assert.equal((await route.GET(getRequest(null))).status, 401);
  principal = { id: "vercel:user", kind: "vercel" };
  assert.equal((await route.GET(getRequest())).status, 200);
  assert.equal((await (await route.GET(getRequest())).json()).storage, "browser");
  assert.equal((await route.PUT(putWorkspace(emptyWorkspace()))).status, 200);
  assert.equal(rows.size, 0);
});

test("Supabase workspace reads and validates only the authenticated user's row", async () => {
  principal = { id: "user-a", kind: "supabase" };
  const empty = emptyWorkspace();
  assert.deepEqual(await (await route.GET(getRequest())).json(), { storage: "cloud", workspace: null, updatedAt: null });
  const create = await route.PUT(putWorkspace(empty));
  assert.equal(create.status, 200);
  const { updatedAt } = await create.json();
  assert.equal(typeof updatedAt, "string");
  assert.deepEqual(rows.get("user-a").workspace, empty);
  assert.deepEqual(await (await route.GET(getRequest())).json(), { storage: "cloud", workspace: empty, updatedAt });
  assert.equal(rows.has("user-b"), false);
  assert.equal((await route.PUT(putWorkspace({ ...empty, maxSteps: 999 }, updatedAt))).status, 400);
  assert.equal((await route.PUT(putRequest("{bad json"))).status, 400);
  assert.equal((await route.PUT(putRequest("x".repeat(200001)))).status, 413);
  assert.equal((await route.PUT(putRequest(JSON.stringify(empty), { contentType: "text/plain" }))).status, 415);
  assert.equal((await route.PUT(putRequest(JSON.stringify({ ...empty, extra: true }), { expectedUserId: "user-a" }))).status, 400);
});

test("workspace request limit counts UTF-8 bytes instead of UTF-16 code units", async () => {
  principal = { id: "user-a", kind: "supabase" };
  const workspace = {
    ...emptyWorkspace(),
    projects: Array.from({ length: 20 }, (_, index) => ({
      id: `unicode-project-${index}`,
      name: `Unicode project ${index}`,
      instructions: "😀".repeat(2_000),
      chatIds: [],
    })),
    notes: Array.from({ length: 30 }, (_, index) => ({
      id: `unicode-note-${index}`,
      text: "😀".repeat(500),
      enabled: true,
      projectId: null,
    })),
  };
  const body = JSON.stringify({ workspace, expectedUpdatedAt: null });
  assert.ok(body.length < 200_000);
  assert.ok(new TextEncoder().encode(body).byteLength > 200_000);
  failDatabase = true;
  assert.equal((await route.PUT(putRequest(body))).status, 413);
  assert.equal(rows.size, 0);
});

test("workspace compare-and-set rejects stale writes and duplicate initial inserts", async () => {
  principal = { id: "user-a", kind: "supabase" };
  const original = emptyWorkspace();
  const first = await route.PUT(putWorkspace(original));
  const firstRevision = (await first.json()).updatedAt;
  assert.equal(first.status, 200);

  const newerWorkspace = { ...original, maxSteps: 13 };
  const newer = await route.PUT(putWorkspace(newerWorkspace, firstRevision));
  const newerRevision = (await newer.json()).updatedAt;
  assert.equal(newer.status, 200);
  assert.notEqual(newerRevision, firstRevision);

  assert.equal((await route.PUT(putWorkspace(original, firstRevision))).status, 409);
  assert.equal((await route.PUT(putWorkspace(original, null))).status, 409);
  assert.deepEqual(rows.get("user-a").workspace, newerWorkspace);
});

test("concurrent first inserts and stale revisions admit one writer and return 409 for the other", async () => {
  principal = { id: "user-a", kind: "supabase" };
  const initialCandidates = [
    { ...emptyWorkspace(), maxSteps: 10 },
    { ...emptyWorkspace(), maxSteps: 11 },
  ];
  const initialResponses = await Promise.all(
    initialCandidates.map((workspace) => route.PUT(putWorkspace(workspace, null))),
  );
  assert.deepEqual(
    initialResponses.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const initialWinner = initialResponses.findIndex((response) => response.status === 200);
  const firstRevision = rows.get("user-a").updated_at;
  assert.deepEqual(rows.get("user-a").workspace, initialCandidates[initialWinner]);

  const updateCandidates = [
    { ...initialCandidates[initialWinner], maxSteps: 20 },
    { ...initialCandidates[initialWinner], maxSteps: 21 },
  ];
  const updateResponses = await Promise.all(
    updateCandidates.map((workspace) => route.PUT(putWorkspace(workspace, firstRevision))),
  );
  assert.deepEqual(
    updateResponses.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  const updateWinner = updateResponses.findIndex((response) => response.status === 200);
  const latest = rows.get("user-a");
  assert.notEqual(latest.updated_at, firstRevision);
  assert.deepEqual(latest.workspace, updateCandidates[updateWinner]);

  assert.equal((await route.PUT(putWorkspace(initialCandidates[initialWinner], firstRevision))).status, 409);
  assert.deepEqual(rows.get("user-a").workspace, updateCandidates[updateWinner]);
});

test("queued writes are bound to their originating account and cannot cross accounts", async () => {
  rows.set("user-a", { user_id: "user-a", workspace: emptyWorkspace(), updated_at: "2026-10-29T12:00:00.000Z" });
  principal = { id: "user-b", kind: "supabase" };
  const before = structuredClone(rows.get("user-a"));
  assert.equal((await route.GET(getRequest("user-a"))).status, 409);
  assert.equal((await route.PUT(putWorkspace({ ...emptyWorkspace(), maxSteps: 5 }, before.updated_at, { expectedUserId: "user-a" }))).status, 409);
  assert.deepEqual(rows.get("user-a"), before);
  assert.equal(rows.has("user-b"), false);
});

test("database failures and corrupt stored workspaces fail without overwriting data", async () => {
  principal = { id: "user-a", kind: "supabase" };
  rows.set("user-a", { user_id: "user-a", workspace: { invalid: true }, updated_at: "2026-10-29T12:00:00.000Z" });
  assert.equal((await route.GET(getRequest())).status, 503);
  failDatabase = true;
  assert.equal((await route.GET(getRequest())).status, 503);
  assert.equal((await route.PUT(putWorkspace(emptyWorkspace()))).status, 503);
  assert.deepEqual(rows.get("user-a").workspace, { invalid: true });
});

test("opt-in Vercel workspace uses verified owner, CAS and fails closed on service errors", async () => {
  process.env.TFLASH_VERCEL_WORKSPACE_SYNC = "1";
  process.env.TFLASH_VERCEL_WORKSPACE_SUPABASE_URL = "https://isolated.example.test";
  process.env.TFLASH_VERCEL_WORKSPACE_SERVICE_ROLE_KEY = "fake-workspace-service-secret";
  principal = { id: "vercel-alice", kind: "vercel" };
  const oldFetch = globalThis.fetch;
  const store = new Map();
  const calls = [];
  let fail = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    const owner = url.searchParams.get("owner_id")?.replace(/^eq\./, "");
    calls.push({ url, options });
    if (fail) return Response.json({ message: "private database details" }, { status: 500 });
    if (options.method === "GET") return Response.json(store.get(owner) ?? null);
    const body = JSON.parse(options.body);
    if (options.method === "POST") {
      if (store.has(body.owner_id)) return Response.json({ code: "23505" }, { status: 409 });
      store.set(body.owner_id, body); return new Response(null, { status: 201 });
    }
    if (options.method === "PATCH") {
      const row = store.get(owner);
      const expected = url.searchParams.get("updated_at")?.replace(/^eq\./, "");
      if (!row || row.updated_at !== expected) return Response.json(null);
      const updated = { ...row, ...body }; store.set(owner, updated);
      return Response.json({ updated_at: updated.updated_at });
    }
    throw new Error("Unexpected workspace service request");
  };
  try {
    assert.equal((await route.GET(getRequest("other-user"))).status, 409);
    assert.equal((await route.PUT(putWorkspace(emptyWorkspace(), null, { expectedUserId:"other-user" }))).status, 409);
    assert.equal(calls.length, 0);
    const initial = await route.GET(getRequest());
    assert.equal(initial.headers.get("cache-control"), "no-store");
    assert.deepEqual(await initial.json(), { storage:"cloud", workspace:null, updatedAt:null });
    const workspace = { ...emptyWorkspace(), memoryEnabled:true, notes:[{id:"note",text:"Personal note",enabled:true,projectId:null}] };
    const created = await route.PUT(putWorkspace(workspace));
    assert.equal(created.status,200);
    const revision = (await created.json()).updatedAt;
    assert.equal(store.get("vercel-alice").workspace.notes[0].text,"Personal note");
    assert.equal((await route.PUT(putWorkspace(workspace,null))).status,409);
    const changed={...workspace,maxSteps:8};
    const updated=await route.PUT(putWorkspace(changed,revision));
    assert.equal(updated.status,200);
    assert.equal((await route.PUT(putWorkspace(workspace,revision))).status,409);
    principal={id:"vercel-bob",kind:"vercel"};
    assert.deepEqual((await (await route.GET(getRequest())).json()).workspace,null);
    assert.equal((await route.PUT(putWorkspace(workspace,revision))).status,409);
    assert.equal(store.get("vercel-alice").workspace.maxSteps,8);
    assert.ok(calls.every(call=>!call.url.href.includes("fake-workspace-service-secret")));
    fail=true;
    const failed=await route.GET(getRequest());
    assert.equal(failed.status,503);
    assert.doesNotMatch(await failed.text(),/private database details|fake-workspace-service-secret/);
    assert.equal((await route.PUT(putWorkspace(workspace))).status,503);
    assert.equal(store.get("vercel-alice").workspace.maxSteps,8);
  } finally {
    globalThis.fetch=oldFetch;
    delete process.env.TFLASH_VERCEL_WORKSPACE_SYNC;
    delete process.env.TFLASH_VERCEL_WORKSPACE_SUPABASE_URL;
    delete process.env.TFLASH_VERCEL_WORKSPACE_SERVICE_ROLE_KEY;
  }
});

test("workspace requests bind the login kind even when account ids happen to match", async () => {
  principal={id:'same-id',kind:'vercel'};
  const headers={'x-tflash-expected-user-id':'same-id','x-tflash-expected-account-kind':'supabase','content-type':'application/json'};
  const get=new Request('https://tflash.example.test/api/workspace',{headers});
  const put=new Request('https://tflash.example.test/api/workspace',{method:'PUT',headers,body:JSON.stringify({workspace:emptyWorkspace(),expectedUpdatedAt:null})});
  assert.equal((await route.GET(get)).status,409);
  assert.equal((await route.PUT(put)).status,409);
  assert.equal(rows.size,0);
});
