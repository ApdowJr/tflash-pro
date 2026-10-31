import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
const tables = new Map();
let unavailable = false,
  listUnavailable = false,
  fetches = 0,
  pendingGrant,
  pendingTaskRead;
globalThis.__db = () => ({
  rpc(name, p) {
    const result = (async () => {
    if (unavailable) return { data: null, error: new Error("unavailable") };
    const table = (name) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
    const key = [p.p_kind,p.p_owner,p.p_session].join("|");
    const epochs = table("tflash_permission_epochs"), grants = table("tflash_permission_grants");
    if (name === "tflash_ensure_permission_epoch") {
      if (!epochs.has(key)) epochs.set(key, {revision: randomUUID()});
      return { data: epochs.get(key).revision, error: null };
    }
    if (name === "tflash_issue_web_decision" || name === "tflash_has_web_decision" || name === "tflash_consume_web_decision") {
      if (pendingGrant) return await pendingGrant;
      const row = grants.get(`${key}|${p.p_origin}`), epoch = epochs.get(key);
      const decisions = table("tflash_web_call_decisions"), decisionKey = `${key}|${p.p_call}`;
      const active = !!(row && epoch && Date.parse(row.expires_at) > Date.now());
      if (name === "tflash_issue_web_decision" && active && !decisions.has(decisionKey)) {
        decisions.set(decisionKey, { origin: p.p_origin, grantRevision: row.revision, epochRevision: epoch.revision });
      }
      const decision = decisions.get(decisionKey);
      const valid = !!(active && decision && !decision.consumed && decision.origin === p.p_origin && decision.grantRevision === row.revision && decision.epochRevision === epoch.revision);
      if (valid && name === "tflash_consume_web_decision") decision.consumed = true;
      return { data: valid, error: null };
    }
    if (name === "tflash_has_web_grant") {
      if (pendingGrant) return await pendingGrant;
      const row = grants.get(`${key}|${p.p_origin}`);
      return { data: !!(epochs.has(key) && row && Date.parse(row.expires_at) > Date.now()), error: null };
    }
    if (name === "tflash_revoke_web_grants") {
      epochs.set(key, {revision: randomUUID()});
      for (const [k, row] of grants) if (k.startsWith(`${key}|`)) { row.expires_at = "1970-01-01T00:00:00.000Z"; row.revision = randomUUID(); }
      return { data: true, error: null };
    }
    if (name === "tflash_change_web_grant") {
      const grantKey = `${key}|${p.p_origin}`, row = grants.get(grantKey);
      if (epochs.get(key)?.revision !== p.p_epoch || (p.p_revision === null ? !!row : !row || row.revision !== p.p_revision)) return {data: false, error: null};
      grants.set(grantKey, {owner_kind:p.p_kind,owner_id:p.p_owner,session_id:p.p_session,origin:p.p_origin, revision:randomUUID(), expires_at: p.p_revoke ? "1970-01-01T00:00:00.000Z" : new Date(Date.now()+3600000).toISOString()});
      return {data:true,error:null};
    }
    throw new Error(`Unexpected RPC ${name}`);
    })();
    return Object.assign(result, { abortSignal() { return result; } });
  },
  from(name) {
    let filters = [],
      action = "select",
      value;
    const rows = () => {
      if (!tables.has(name)) tables.set(name, new Map());
      return tables.get(name);
    };
    const key = (r) =>
      [
        r.owner_kind,
        r.owner_id,
        r.session_id,
        ...(name === "tflash_permission_grants" ? [r.origin] : []),
      ].join("|");
    const q = {
      select() {
        return this;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return this;
      },
      in(k, values) {
        filters.push((r) => values.includes(r[k]));
        return this;
      },
      insert(v) {
        action = "insert";
        value = v;
        return this;
      },
      gt(k, v) {
        filters.push((r) => r[k] > v);
        return this;
      },
      order() {
        return this;
      },
      limit() { return this; },
      upsert(v) {
        action = "upsert";
        value = v;
        return this;
      },
      delete() {
        action = "delete";
        return this;
      },
      update(v) {
        action = "update";
        value = v;
        return this;
      },
      async maybeSingle() {
        if (name === "tflash_tracked_tasks" && pendingTaskRead) await pendingTaskRead;
        const r = await this;
        return { ...r, data: r.data?.[0] ?? null };
      },
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => {
            if (unavailable || (listUnavailable && name === "tflash_permission_grants" && action === "select"))
              return { data: null, error: new Error("unavailable") };
            if (action === "insert" && rows().has(key(value))) return { data: null, error: { code: "23505" } };
            if (action === "upsert" || action === "insert") rows().set(key(value), { ...value });
            const selected = [...rows().values()].filter((r) =>
              filters.every((f) => f(r)),
            );
            if (action === "delete")
              for (const r of selected) rows().delete(key(r));
            if (action === "update")
              for (const r of selected) Object.assign(r, value);
            return { data: selected, error: null, count: selected.length };
          })
          .then(resolve, reject);
      },
    };
    return q;
  },
});
globalThis.__owner = async (req, sessionId) => {
  const [kind, userId] = (req.headers.get("x-test-user") ?? "").split(":");
  return sessionId === "session-a" &&
    userId === "alice" &&
    ["supabase", "vercel"].includes(kind)
    ? { kind, userId }
    : null;
};
globalThis.__fetch = async () => {
  fetches++;
  return { content: "Page", contentType: "text/plain", truncated: false };
};
registerHooks({
  resolve(s, c, n) {
    if (s === "@supabase/supabase-js")
      return {
        url: "data:text/javascript,export const createClient = () => globalThis.__db()",
        shortCircuit: true,
      };
    if (s === "@/lib/security/owned-chat")
      return {
        url: "data:text/javascript,export const ownedChat = (...args) => globalThis.__owner(...args)",
        shortCircuit: true,
      };
    if (s === "@/lib/permission-web-fetch")
      return {
        url: "data:text/javascript,export const fetchGrantedHomepage = (...args) => globalThis.__fetch(...args)",
        shortCircuit: true,
      };
    if (s === "@/lib/research-evidence")
      return {
        url: 'data:text/javascript,export const researchOwner = () => true; export const sealSourceReceipt = async () => "receipt"',
        shortCircuit: true,
      };
    if (s.startsWith("@/"))
      return {
        url: new URL(`../${s.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    if (
      c.parentURL?.startsWith(new URL("../lib/", import.meta.url).href) &&
      /^\.\//.test(s) &&
      !/\.[cm]?[jt]s$/.test(s)
    )
      return n(`${s}.ts`, c);
    return n(s, c);
  },
});
process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = "test-only";
process.env.TFLASH_PERMISSIONS_SUPABASE_URL = "https://database.example.test";
const revokeAll = await import("../app/api/chats/[sessionId]/permissions/revoke-all/route.ts");
const permissions = await import(
    "../app/api/chats/[sessionId]/permissions/route.ts"
  ),
  tasks = await import("../app/api/chats/[sessionId]/task/route.ts"),
  web = (await import("../agent/tools/web_fetch.ts")).default,
  verify = (await import("../agent/tools/verify_tracked_task.ts")).default;
const route = { params: Promise.resolve({ sessionId: "session-a" }) };
function req(
  method,
  user = "supabase:alice",
  body = { origin: "https://example.com" },
  origin = "https://app.test",
) {
  return new Request("https://app.test/api/chats/session-a/permissions", {
    method,
    headers: {
      "x-test-user": user,
      origin,
      "content-type": "application/json",
    },
    ...(["POST", "PUT", "DELETE"].includes(method)
      ? { body: JSON.stringify(body) }
      : {}),
  });
}
function permissionReq(method = "GET", user = "supabase:alice", body = { origin: "https://example.com" }, origin = "https://app.test") {
  const [kind, id] = user.split(":");
  let normalized; try { normalized = new URL(body.origin).origin; } catch { normalized = body.origin; }
  const key = [kind, id, "session-a"].join("|");
  if (!tables.has("tflash_permission_epochs")) tables.set("tflash_permission_epochs", new Map());
  const epochs = tables.get("tflash_permission_epochs");
  if (!epochs.has(key)) epochs.set(key, { revision: randomUUID() });
  const row = tables.get("tflash_permission_grants")?.get(`${key}|${normalized}`);
  return req(method, user, { ...body, expectedRevision: row?.revision ?? null, expectedEpoch: epochs.get(key).revision }, origin);
}
let nextCallId = 0;
function context(
  kind = "supabase",
  id = "alice",
  url = "https://example.com/",
) {
  const p = {
    principalId: id,
    principalType: "user",
    authenticator: kind === "supabase" ? "supabase" : "better-auth:vercel",
    attributes: {},
  };
  return {
    session: { id: "session-a", auth: { current: p, initiator: p } },
    toolInput: { url },
    toolName: "web_fetch",
    callId: `call-${++nextCallId}`,
    abortSignal: new AbortController().signal,
  };
}
const expected = createHash("sha256").update("correct file").digest("hex"),
  definition = {
    objective: "Create my file",
    path: "output.txt",
    sha256: expected,
    continuationBudget: 0,
  };
const stream = (content) =>
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(content));
      c.close();
    },
  });
async function task(user = "supabase:alice") {
  return (await (await tasks.GET(req("GET", user), route)).json()).task;
}
test("permission route and actual Eve gate enforce identity, scope, expiry, revocation and storage failures", async () => {
  tables.clear();
  fetches = 0;
  const ctx = context();
  assert.equal(await web.approval(ctx), "user-approval");
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 200);
  assert.equal(await web.approval(ctx), "not-applicable");
  assert.equal(await web.approval(ctx), "not-applicable");
  await web.execute({ url: "https://example.com/" }, ctx);
  assert.equal(fetches, 1);
  for (const url of [
    "https://example.com/private",
    "https://example.com/?x=1",
    "https://other.example/",
  ])
    assert.equal(
      await web.approval(context("supabase", "alice", url)),
      "user-approval",
    );
  assert.equal(await web.approval(context("supabase", "bob")), "user-approval");
  assert.equal(await web.approval(context("vercel")), "user-approval");
  assert.equal(
    (await permissions.GET(req("GET", "supabase:bob"), route)).status,
    404,
  );
  assert.equal(
    (
      await permissions.POST(
        permissionReq("POST", "supabase:alice", { origin: "https://example.com/path" }),
        route,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await permissions.DELETE(
        permissionReq("DELETE", "supabase:alice", {}, "https://evil.test"),
        route,
      )
    ).status,
    403,
  );
  assert.equal((await permissions.DELETE(permissionReq("DELETE"), route)).status, 200);
  assert.equal(await web.approval(ctx), "user-approval");
  await assert.rejects(
    web.execute({ url: "https://example.com/" }, ctx),
    /no longer active/,
  );
  assert.equal(fetches, 1);
  assert.equal(
    (await permissions.POST(permissionReq("POST", "vercel:alice"), route)).status,
    200,
  );
  assert.equal(await web.approval(context("vercel")), "not-applicable");
  for (const row of tables.get("tflash_permission_grants").values())
    row.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await web.approval(context("vercel")), "user-approval");
  unavailable = true;
  assert.equal(await web.approval(ctx), "user-approval");
  assert.equal((await permissions.GET(req("GET"), route)).status, 503);
  unavailable = false;
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 200);
  assert.equal(await web.approval(ctx), "user-approval"); // Old call remains bound to the revoked revision.
  assert.equal(await web.approval(context()), "not-applicable");
  const otherSession = context();
  otherSession.session = { ...otherSession.session, id: "session-b" };
  assert.equal(await web.approval(otherSession), "user-approval");
  delete process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY;
  assert.equal(await web.approval(ctx), "user-approval");
  await assert.rejects(
    web.execute({ url: "https://example.com/" }, ctx),
    /not configured/,
  );
  assert.equal(fetches, 1);
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 503);
  process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = "test-only";
});
test("persisted user criterion requires actual file evidence and cancellation or replacement defeats stale verification", async () => {
  tables.clear();
  assert.equal(
    (await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: (await task())?.revision ?? null }), route)).status,
    200,
  );
  const ctx = context();
  ctx.getSandbox = async () => ({ readFile: async () => null });
  assert.equal((await verify.execute({}, ctx)).status, "awaiting_evidence");
  assert.equal((await task()).state, "awaiting_evidence");
  ctx.getSandbox = async () => ({ readFile: async () => stream("wrong") });
  assert.equal((await verify.execute({}, ctx)).status, "awaiting_evidence");
  ctx.getSandbox = async () => ({
    readFile: async () => stream("correct file"),
  });
  assert.equal((await verify.execute({}, ctx)).status, "criterion_matched");
  assert.equal((await task()).state, "criterion_matched");
  ctx.getSandbox = async () => ({ readFile: async () => stream("changed") });
  assert.equal((await verify.execute({}, ctx)).status, "awaiting_evidence");
  assert.equal((await task()).state, "awaiting_evidence");
  assert.equal(await task("vercel:alice"), null);
  assert.equal(
    (await tasks.GET(req("GET", "supabase:bob"), route)).status,
    404,
  );
  assert.equal(
    (
      await tasks.PUT(
        req("PUT", "supabase:alice", { task: { ...definition, path: "foo/.." }, expectedRevision: (await task()).revision }),
        route,
      )
    ).status,
    400,
  );
  for (const mode of ["cancel", "replace"]) {
    assert.equal(
      (await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: (await task())?.revision ?? null }), route)).status,
      200,
    );
    let release, started;
    const ready = new Promise((r) => {
      started = r;
    });
    ctx.getSandbox = async () => ({
      readFile: async () => {
        started();
        await new Promise((r) => {
          release = r;
        });
        return stream("correct file");
      },
    });
    const pending = verify.execute({}, ctx);
    await ready;
    if (mode === "cancel")
      assert.equal((await tasks.DELETE(req("DELETE", "supabase:alice", { expectedRevision: (await task()).revision }), route)).status, 200);
    else
      assert.equal(
        (
          await tasks.PUT(
            req("PUT", "supabase:alice", {
              task: { ...definition, objective: "New objective" },
              expectedRevision: (await task()).revision,
            }),
            route,
          )
        ).status,
        200,
      );
    release();
    assert.equal((await pending).status, "changed");
    assert.equal(
      (await task()).state,
      mode === "cancel" ? "cancelled" : "awaiting_evidence",
    );
  }
});


test("stale task edits and cancels cannot replace or cancel a newer task", async () => {
  tables.clear();
  assert.equal((await tasks.PUT(req("PUT", "supabase:alice", {task: definition, expectedRevision: null}), route)).status, 200);
  const old = (await task()).revision;
  assert.equal((await tasks.PUT(req("PUT", "supabase:alice", {task: {...definition, objective: "newer"}, expectedRevision: old}), route)).status, 200);
  const staleTask = await tasks.PUT(req("PUT", "supabase:alice", {task: definition, expectedRevision: old}), route);
  assert.equal(staleTask.status, 409);
  assert.equal((await staleTask.json()).changeNotStarted, true);
  assert.equal((await tasks.PUT(req("PUT", "supabase:alice", {task: definition, expectedRevision: null}), route)).status, 409);
  assert.equal((await tasks.DELETE(req("DELETE", "supabase:alice", {expectedRevision: old}), route)).status, 409);
  assert.equal((await task()).objective, "newer");
  assert.equal((await task()).state, "awaiting_evidence");
});

test("overlapping verification cannot overwrite newer evidence", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", {task: definition, expectedRevision: null}), route);
  let release, started; const ready = new Promise(r => { started = r; });
  const slow = context(); slow.getSandbox = async () => ({ readFile: async () => { started(); await new Promise(r => { release = r; }); return stream("correct file"); } });
  const pending = verify.execute({}, slow); await ready;
  const fast = context(); fast.getSandbox = async () => ({ readFile: async () => stream("changed") });
  assert.equal((await verify.execute({}, fast)).status, "awaiting_evidence");
  release(); assert.equal((await pending).status, "changed");
  assert.equal((await task()).state, "awaiting_evidence");
});


test("aborted verification does not record a match", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", {task: definition, expectedRevision: null}), route);
  const before = await task(); const controller = new AbortController();
  const ctx = context(); ctx.abortSignal = controller.signal;
  ctx.getSandbox = async () => ({ readFile: async () => { controller.abort(); return stream("correct file"); } });
  await assert.rejects(verify.execute({}, ctx));
  assert.deepEqual(await task(), before);
});


test("stale grants and revokes cannot undo a newer permission decision", async () => {
  tables.clear(); const ctx = context();
  const initialGrant = permissionReq("POST");
  assert.equal((await permissions.POST(initialGrant, route)).status, 200);
  const staleGrant = permissionReq("POST"), staleRevoke = permissionReq("DELETE");
  assert.equal((await permissions.DELETE(permissionReq("DELETE"), route)).status, 200);
  assert.equal(await web.approval(ctx), "user-approval");
  const staleGrantResult = await permissions.POST(staleGrant, route);
  assert.equal(staleGrantResult.status, 409);
  assert.equal((await staleGrantResult.json()).changeNotStarted, true);
  assert.equal(await web.approval(ctx), "user-approval");
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 200);
  assert.equal((await permissions.DELETE(staleRevoke, route)).status, 409);
  assert.equal(await web.approval(ctx), "not-applicable");
  assert.equal((await permissions.POST(req("POST", "supabase:alice", {origin: "https://example.com", expectedRevision: null, expectedEpoch: tables.get("tflash_permission_epochs").get("supabase|alice|session-a").revision}), route)).status, 409);
});


test("emergency revoke works without listing and blocks delayed grants, then permits explicit new grants", async () => {
  tables.clear(); const ctx = context();
  const staleNew = permissionReq("POST", "supabase:alice", {origin:"https://other.example"});
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 200);
  assert.equal(await web.approval(ctx), "not-applicable");
  listUnavailable = true;
  assert.equal((await permissions.GET(req("GET"), route)).status, 503);
  assert.equal(await web.approval(ctx), "not-applicable"); // A panel failure is not revocation.
  assert.equal((await revokeAll.POST(req("POST"), route)).status, 200);
  listUnavailable = false;
  assert.equal(await web.approval(ctx), "user-approval");
  assert.equal((await permissions.POST(staleNew, route)).status, 409);
  assert.equal((await permissions.POST(permissionReq("POST"), route)).status, 200);
  assert.equal(await web.approval(ctx), "user-approval");
  assert.equal(await web.approval(context()), "not-applicable");
  assert.equal((await revokeAll.POST(req("POST", "supabase:alice", {}, "https://evil.test"), route)).status, 403);
  assert.equal((await revokeAll.POST(req("POST", "supabase:bob"), route)).status, 404);
  unavailable = true;
  assert.equal((await revokeAll.POST(req("POST"), route)).status, 503);
  unavailable = false;
});


test("an interrupted reusable-grant check cannot approve or start a fetch after a late store result", async () => {
  let release;
  pendingGrant = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController(), ctx = { ...context(), abortSignal: controller.signal };
  const previousFetches = fetches;
  try {
    const gate = web.approval(ctx);
    const execution = web.execute({ url: "https://example.com/" }, ctx);
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(gate, { name: "AbortError" });
    await assert.rejects(execution, { name: "AbortError" });
    release({ data: true, error: null });
    await pendingGrant;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches, previousFetches);
  } finally { pendingGrant = undefined; }
});

test("cancellation while sandbox initialization hangs never reads or settles the task", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: null }), route);
  const before = await task();
  const controller = new AbortController(), ctx = { ...context(), abortSignal: controller.signal };
  let started, release, reads = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  ctx.getSandbox = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const pending = verify.execute({}, ctx);
  await ready;
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
  release({ readFile: async () => { reads++; return stream("correct file"); } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.deepEqual(await task(), before);
});

test("a late sandbox stream is cancelled and cannot settle verification after stop", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: null }), route);
  const before = await task();
  const controller = new AbortController(), ctx = { ...context(), abortSignal: controller.signal };
  let started, release, cancelled = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  ctx.getSandbox = async () => ({ readFile: () => { started(); return new Promise((resolve) => { release = resolve; }); } });
  const pending = verify.execute({}, ctx);
  await ready;
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
  release(new ReadableStream({ cancel() { cancelled++; } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.deepEqual(await task(), before);
});

test("a stuck file read and stuck stream cancellation do not delay stop or change task evidence", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: null }), route);
  const before = await task();
  const controller = new AbortController(), ctx = { ...context(), abortSignal: controller.signal };
  let started, cancelled = 0;
  const ready = new Promise((resolve) => { started = resolve; });
  const uncooperative = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled++; return new Promise(() => {}); },
  });
  const originalGetReader = uncooperative.getReader.bind(uncooperative);
  uncooperative.getReader = () => {
    const reader = originalGetReader(), originalRead = reader.read.bind(reader);
    reader.read = () => { started(); return originalRead(); };
    return reader;
  };
  ctx.getSandbox = async () => ({ readFile: async () => uncooperative });
  const pending = verify.execute({}, ctx);
  await ready;
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, 1);
  assert.deepEqual(await task(), before);
});

test("verification deadline fails without recording incomplete evidence", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: null }), route);
  const before = await task(), ctx = context();
  ctx.getSandbox = () => new Promise(() => {});
  const realTimeout = AbortSignal.timeout;
  try {
    // Accelerate the real 20-second deadline without starting any remote service.
    AbortSignal.timeout = () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 10);
      return controller.signal;
    };
    await assert.rejects(verify.execute({}, ctx), { name: "TimeoutError" });
  } finally { AbortSignal.timeout = realTimeout; }
  assert.deepEqual(await task(), before);
});


test("cancellation during task lookup cannot start a sandbox or settle a late result", async () => {
  tables.clear();
  await tasks.PUT(req("PUT", "supabase:alice", { task: definition, expectedRevision: null }), route);
  const before = await task();
  const controller = new AbortController(), ctx = { ...context(), abortSignal: controller.signal };
  let release, sandboxOpens = 0;
  pendingTaskRead = new Promise((resolve) => { release = resolve; });
  ctx.getSandbox = async () => { sandboxOpens++; return { readFile: async () => stream("correct file") }; };
  try {
    const pending = verify.execute({}, ctx);
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await assert.rejects(pending, { name: "AbortError" });
    release();
    await pendingTaskRead;
    pendingTaskRead = undefined;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sandboxOpens, 0);
    assert.deepEqual(await task(), before);
  } finally { pendingTaskRead = undefined; }
});
