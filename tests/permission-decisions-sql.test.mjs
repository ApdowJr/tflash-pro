import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("real isolated SQL binds each call to grant revision and epoch and consumes at most once", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const name of ["20261030120000_create_tflash_permission_grants.sql", "20261030130000_permission_grant_revisions.sql", "20261030140000_permission_emergency_revocation.sql", "20261030150000_permission_call_decisions.sql"]) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    const roles = (await db.query(`select has_table_privilege('authenticated','public.tflash_web_call_decisions','select') as auth_read,
      has_function_privilege('anon','public.tflash_issue_web_decision(text,text,text,text,text)','execute') as anon_issue,
      has_function_privilege('authenticated','public.tflash_consume_web_decision(text,text,text,text,text)','execute') as auth_consume,
      has_function_privilege('service_role','public.tflash_consume_web_decision(text,text,text,text,text)','execute') as service_consume`)).rows[0];
    assert.deepEqual(roles, { auth_read: false, anon_issue: false, auth_consume: false, service_consume: true });
    assert.equal((await db.query(`select relrowsecurity from pg_class where relname='tflash_web_call_decisions'`)).rows[0].relrowsecurity, true);
    await db.exec("set role service_role");
    const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) as value`,args)).rows[0].value;
    const owner = ["supabase","alice","session"], origin = "https://example.com";
    const epoch = await call("tflash_ensure_permission_epoch", owner);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"old"]), false);
    assert.equal(await call("tflash_change_web_grant", [...owner,origin,null,epoch,false]), true);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"old"]), true);
    assert.equal(await call("tflash_has_web_decision", [...owner,origin,"old"]), true);
    assert.equal(await call("tflash_has_web_decision", [...owner,"https://other.example","old"]), false);
    assert.equal(await call("tflash_has_web_decision", ["supabase","bob","session",origin,"old"]), false);
    const revision = (await db.query(`select revision from public.tflash_permission_grants where owner_id='alice' and origin=$1`,[origin])).rows[0].revision;
    assert.equal(await call("tflash_change_web_grant", [...owner,origin,revision,epoch,true]), true);
    const revoked = (await db.query(`select revision from public.tflash_permission_grants where owner_id='alice' and origin=$1`,[origin])).rows[0].revision;
    assert.equal(await call("tflash_change_web_grant", [...owner,origin,revoked,epoch,false]), true);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"old"]), false);
    assert.equal(await call("tflash_consume_web_decision", [...owner,origin,"old"]), false);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"new"]), true);
    assert.equal(await call("tflash_consume_web_decision", [...owner,origin,"new"]), true);
    assert.equal(await call("tflash_consume_web_decision", [...owner,origin,"new"]), false);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"new"]), false);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"epoch-call"]), true);
    assert.equal(await call("tflash_revoke_web_grants", owner), true);
    const epoch2 = await call("tflash_ensure_permission_epoch",owner);
    const revision2 = (await db.query(`select revision from public.tflash_permission_grants where owner_id='alice' and origin=$1`,[origin])).rows[0].revision;
    assert.equal(await call("tflash_change_web_grant", [...owner,origin,revision2,epoch2,false]), true);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"epoch-call"]), false);
    assert.equal(await call("tflash_consume_web_decision", [...owner,origin,"epoch-call"]), false);
    assert.equal(await call("tflash_issue_web_decision", [...owner,origin,"fresh"]), true);
    await db.exec("reset role");
    await db.query(`update public.tflash_permission_grants set expires_at=now()-interval '1 second' where owner_id='alice' and origin=$1`,[origin]);
    await db.exec("set role service_role");
    assert.equal(await call("tflash_consume_web_decision", [...owner,origin,"fresh"]), false);
    await db.exec("reset role");
    // The retained per-session bound fails closed rather than evicting old
    // call tombstones which could otherwise make a replay look new.
    const capOwner = ["supabase","capacity","session"];
    await db.exec("set role service_role");
    const capEpoch = await call("tflash_ensure_permission_epoch", capOwner);
    assert.equal(await call("tflash_change_web_grant", [...capOwner,origin,null,capEpoch,false]), true);
    await db.exec("reset role");
    await db.query(`insert into public.tflash_web_call_decisions(owner_kind,owner_id,session_id,call_id,origin,grant_revision,epoch_revision)
      select g.owner_kind,g.owner_id,g.session_id,'old-'||n,g.origin,g.revision,$2 from public.tflash_permission_grants g cross join generate_series(1,2000) n
      where g.owner_id='capacity' and g.origin=$1`, [origin,capEpoch]);
    await db.exec("set role service_role");
    assert.equal(await call("tflash_issue_web_decision", [...capOwner,origin,"new-over-limit"]), false);
    assert.equal(await call("tflash_issue_web_decision", [...capOwner,origin,"old-1"]), true);
    await db.exec("reset role");
  } finally { await db.close(); }
});
