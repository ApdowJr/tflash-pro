import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real supabase-js HTTP serialization against an isolated local SQL-backed
// protocol fixture. This is not a live Supabase/PostgREST deployment.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/security/owned-chat") return { url: "data:text/javascript,export const ownedChat=async(req,id)=>id==='session-a'&&req.headers.get('x-test-user')==='alice'?{kind:'supabase',userId:'alice'}:null", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const permissions = await import("../app/api/chats/[sessionId]/permissions/route.ts");
const revoke = await import("../app/api/chats/[sessionId]/permissions/revoke-all/route.ts");
const { hasWebGrant } = await import("../lib/permission-store.ts");

test("real client HTTP to isolated SQL enforces emergency revoke despite listing failure", async () => {
  const db = new PGlite();
  let failList = false;
  let server;
  const oldUrl = process.env.TFLASH_PERMISSIONS_SUPABASE_URL, oldKey = process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY;
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const name of ["20261030120000_create_tflash_permission_grants.sql", "20261030130000_permission_grant_revisions.sql", "20261030140000_permission_emergency_revocation.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    const calls = {
      tflash_ensure_permission_epoch: ["p_kind", "p_owner", "p_session"],
      tflash_change_web_grant: ["p_kind", "p_owner", "p_session", "p_origin", "p_revision", "p_epoch", "p_revoke"],
      tflash_revoke_web_grants: ["p_kind", "p_owner", "p_session"],
      tflash_has_web_grant: ["p_kind", "p_owner", "p_session", "p_origin"],
    };
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://localhost"), method = request.method;
        response.setHeader("content-type", "application/json");
        if (method === "POST" && url.pathname.startsWith("/rest/v1/rpc/")) {
          const name = url.pathname.split("/").at(-1), params = calls[name];
          if (!params) { response.writeHead(404).end("{}"); return; }
          let raw = ""; for await (const chunk of request) raw += chunk;
          const body = JSON.parse(raw), marks = params.map((_, i) => `$${i+1}`).join(",");
          const result = await db.query(`select public.${name}(${marks}) as value`, params.map(key => body[key]));
          response.end(JSON.stringify(result.rows[0].value)); return;
        }
        if (method === "GET" && url.pathname === "/rest/v1/tflash_permission_grants") {
          if (failList) { response.writeHead(503).end('{"message":"list unavailable"}'); return; }
          const result = await db.query(`select origin,expires_at,revision from public.tflash_permission_grants where owner_kind=$1 and owner_id=$2 and session_id=$3 order by origin`, ["supabase","alice","session-a"]);
          response.setHeader("content-range", result.rows.length ? `0-${result.rows.length-1}/${result.rows.length}` : "*/0");
          response.end(JSON.stringify(result.rows)); return;
        }
        response.writeHead(404).end("{}");
      } catch { response.writeHead(500).end('{"message":"fixture failure"}'); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.TFLASH_PERMISSIONS_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = "fixture-only";
    const route = { params: Promise.resolve({sessionId:"session-a"}) }, owner = {kind:"supabase",id:"alice",sessionId:"session-a"};
    const req = (method, body) => new Request("https://app.test/api/chats/session-a/permissions", {method, headers:{"x-test-user":"alice",origin:"https://app.test","content-type":"application/json"}, ...(body ? {body:JSON.stringify(body)} : {})});
    const initial = await (await permissions.GET(req("GET"), route)).json();
    const body = {origin:"https://example.com",expectedRevision:null,expectedEpoch:initial.epoch};
    const pair = await Promise.all([permissions.POST(req("POST",body),route), permissions.POST(req("POST",body),route)]);
    assert.deepEqual(pair.map(r => r.status).sort(), [200,409]);
    assert.equal(await hasWebGrant(owner,"https://example.com/"), true);
    failList = true;
    assert.equal((await permissions.GET(req("GET"),route)).status,503);
    assert.equal(await hasWebGrant(owner,"https://example.com/"), true);
    assert.equal((await revoke.POST(req("POST"),route)).status,200);
    assert.equal(await hasWebGrant(owner,"https://example.com/"), false);
    failList = false;
    assert.equal((await permissions.POST(req("POST", {...body,origin:"https://other.example"}),route)).status,409);
  } finally {
    if (oldUrl === undefined) delete process.env.TFLASH_PERMISSIONS_SUPABASE_URL; else process.env.TFLASH_PERMISSIONS_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY; else process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY = oldKey;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
});
