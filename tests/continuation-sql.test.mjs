import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("durable continuation SQL spends bounded turns once, fences stale tasks, and retains uncertain attempts", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["20261030120000_create_tflash_permission_grants.sql", "20261030130000_permission_grant_revisions.sql", "20261030140000_permission_emergency_revocation.sql", "20261030150000_permission_call_decisions.sql", "20261030160000_task_continuation_attempts.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const privileges = (await db.query(`select has_table_privilege('authenticated','public.tflash_task_continuation_attempts','select') as auth_read, has_function_privilege('anon','public.tflash_begin_continuation(text,text,text,uuid)','execute') as anon_begin, has_function_privilege('service_role','public.tflash_begin_continuation(text,text,text,uuid)','execute') as service_begin`)).rows[0];
    assert.deepEqual(privileges,{auth_read:false,anon_begin:false,service_begin:true});
    assert.equal((await db.query(`select relrowsecurity from pg_class where relname='tflash_task_continuation_attempts'`)).rows[0].relrowsecurity,true);
    let revision = randomUUID();
    await db.query(`insert into public.tflash_tracked_tasks values ('supabase','alice','session',$1,'objective','file.txt',$2,2,'awaiting_evidence',null,null)`,[revision,"a".repeat(64)]);
    await db.exec("set role service_role");
    const call = async (fn,args) => (await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args)).rows[0].value;
    const owner = ["supabase","alice","session"], attempt = randomUUID(), other = randomUUID();
    assert.equal(await call('tflash_reserve_continuation',[...owner,revision,attempt]),true);
    // A lost reservation response is not permission to reserve or dispatch again.
    assert.equal(await call('tflash_reserve_continuation',[...owner,revision,attempt]),false);
    let task = (await db.query(`select revision,continuation_budget from public.tflash_tracked_tasks where owner_id='alice'`)).rows[0];
    assert.equal(task.continuation_budget,1); assert.notEqual(task.revision,revision);
    assert.equal(await call('tflash_reserve_continuation',[...owner,task.revision,other]),false);
    assert.equal(await call('tflash_begin_continuation',["supabase","bob","session",attempt]),false);
    assert.equal(await call('tflash_begin_continuation',[...owner,attempt]),true);
    assert.equal(await call('tflash_begin_continuation',[...owner,attempt]),false);
    assert.equal(await call('tflash_review_continuation',[...owner,attempt,'short']),false);
    assert.equal(await call('tflash_review_continuation',[...owner,attempt,'Checked external service; outcome still unknown.']),true);
    assert.equal(await call('tflash_review_continuation',[...owner,attempt,'Checked again and reviewed.']),false);
    // Reviewing is not evidence of settlement and does not make an old ID reusable.
    assert.equal(await call('tflash_reserve_continuation',[...owner,task.revision,attempt]),false);
    assert.equal(await call('tflash_reserve_continuation',[...owner,task.revision,other]),true);
    task = (await db.query(`select revision,continuation_budget from public.tflash_tracked_tasks where owner_id='alice'`)).rows[0];
    assert.equal(task.continuation_budget,0);
    await db.query(`update public.tflash_tracked_tasks set revision=$1,state='cancelled' where owner_id='alice'`,[randomUUID()]);
    assert.equal(await call('tflash_begin_continuation',[...owner,other]),false);
    assert.equal(await call('tflash_reserve_continuation',[...owner,task.revision,randomUUID()]),false);
    const replacement=randomUUID();
    await db.query(`update public.tflash_tracked_tasks set revision=$1,state='awaiting_evidence',continuation_budget=3 where owner_id='alice'`,[replacement]);
    assert.equal(await call('tflash_begin_continuation',[...owner,other]),false, 'replacement fences stale reservation');
    assert.equal(await call('tflash_reserve_continuation',[...owner,replacement,randomUUID()]),false, 'replacement cannot discard an unresolved attempt');
    const rows = (await db.query(`select state,review_note from public.tflash_task_continuation_attempts order by state`)).rows;
    assert.deepEqual(rows,[{state:'reserved',review_note:null},{state:'reviewed',review_note:'Checked external service; outcome still unknown.'}]);
    assert.equal(await call('tflash_review_continuation',[...owner,other,'Stopped and checked; no remote confirmation.']),true);
    assert.equal(await call('tflash_reserve_continuation',[...owner,replacement,randomUUID()]),true);
  } finally { await db.close(); }
});
