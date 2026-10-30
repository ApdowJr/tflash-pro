import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const tables = new Map();
let unavailable = false,
  fetches = 0;
globalThis.__db = () => ({
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
      gt(k, v) {
        filters.push((r) => r[k] > v);
        return this;
      },
      order() {
        return this;
      },
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
        const r = await this;
        return { ...r, data: r.data?.[0] ?? null };
      },
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => {
            if (unavailable)
              return { data: null, error: new Error("unavailable") };
            if (action === "upsert") rows().set(key(value), { ...value });
            const selected = [...rows().values()].filter((r) =>
              filters.every((f) => f(r)),
            );
            if (action === "delete")
              for (const r of selected) rows().delete(key(r));
            if (action === "update")
              for (const r of selected) Object.assign(r, value);
            return { data: selected, error: null };
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
  assert.equal((await permissions.POST(req("POST"), route)).status, 200);
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
        req("POST", "supabase:alice", { origin: "https://example.com/path" }),
        route,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await permissions.DELETE(
        req("DELETE", "supabase:alice", {}, "https://evil.test"),
        route,
      )
    ).status,
    403,
  );
  assert.equal((await permissions.DELETE(req("DELETE"), route)).status, 200);
  assert.equal(await web.approval(ctx), "user-approval");
  await assert.rejects(
    web.execute({ url: "https://example.com/" }, ctx),
    /no longer active/,
  );
  assert.equal(fetches, 1);
  assert.equal(
    (await permissions.POST(req("POST", "vercel:alice"), route)).status,
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
  assert.equal((await permissions.POST(req("POST"), route)).status, 200);
  assert.equal(await web.approval(ctx), "not-applicable");
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
  assert.equal((await permissions.POST(req("POST"), route)).status, 503);
  process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = "test-only";
});
test("persisted user criterion requires actual file evidence and cancellation or replacement defeats stale verification", async () => {
  tables.clear();
  assert.equal(
    (await tasks.PUT(req("PUT", "supabase:alice", definition), route)).status,
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
  assert.equal(await task("vercel:alice"), null);
  assert.equal(
    (await tasks.GET(req("GET", "supabase:bob"), route)).status,
    404,
  );
  assert.equal(
    (
      await tasks.PUT(
        req("PUT", "supabase:alice", { ...definition, path: "foo/.." }),
        route,
      )
    ).status,
    400,
  );
  for (const mode of ["cancel", "replace"]) {
    assert.equal(
      (await tasks.PUT(req("PUT", "supabase:alice", definition), route)).status,
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
      assert.equal((await tasks.DELETE(req("DELETE"), route)).status, 200);
    else
      assert.equal(
        (
          await tasks.PUT(
            req("PUT", "supabase:alice", {
              ...definition,
              objective: "New objective",
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
