import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("unresolved holds fence stale reviews, prevent late begin, and keep web grants paused", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["20261030120000_create_tflash_permission_grants.sql", "20261030130000_permission_grant_revisions.sql", "20261030140000_permission_emergency_revocation.sql", "20261030150000_permission_call_decisions.sql", "20261030160000_task_continuation_attempts.sql", "20261030170000_continuation_review_fencing.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const perms=(await db.query(`select has_function_privilege('service_role','public.tflash_review_continuation(text,text,text,uuid,text)','execute') as old_review, has_function_privilege('service_role','public.tflash_resolve_continuation(text,text,text,uuid,uuid,text)','execute') as new_review, has_function_privilege('authenticated','public.tflash_hold_continuation(text,text,text,uuid,uuid,text)','execute') as auth_hold`)).rows[0];
    assert.deepEqual(perms,{old_review:false,new_review:true,auth_hold:false});
    const revision=randomUUID(), owner=['supabase','alice','session'], origin='https://example.com', attempt=randomUUID();
    await db.query(`insert into public.tflash_tracked_tasks values ('supabase','alice','session',$1,'objective','file.txt',$2,2,'awaiting_evidence',null,null)`,[revision,'a'.repeat(64)]);
    await db.exec('set role service_role');
    const call=async(fn,args)=>(await db.query(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args)).rows[0].value;
    const epoch=await call('tflash_ensure_permission_epoch',owner);
    assert.equal(await call('tflash_change_web_grant',[...owner,origin,null,epoch,false]),true);
    assert.equal(await call('tflash_issue_web_decision',[...owner,origin,'old-call']),true);
    assert.equal(await call('tflash_reserve_continuation',[...owner,revision,attempt]),true);
    const initial=(await db.query(`select review_revision from public.tflash_task_continuation_attempts where attempt_id=$1`,[attempt])).rows[0].review_revision;
    assert.equal(await call('tflash_issue_web_decision',[...owner,origin,'pending-call']),false);
    assert.equal(await call('tflash_hold_continuation',[...owner,attempt,initial,'External outcome remains unknown.']),true);
    assert.equal(await call('tflash_begin_continuation',[...owner,attempt]),false,'hold prevents a late begin');
    assert.equal(await call('tflash_resolve_continuation',[...owner,attempt,initial,'I checked and reviewed the turn.']),false,'stale review cannot erase hold');
    let row=(await db.query(`select review_revision,hold_note,state from public.tflash_task_continuation_attempts where attempt_id=$1`,[attempt])).rows[0];
    assert.equal(row.state,'reserved'); assert.equal(row.hold_note,'External outcome remains unknown.');
    assert.equal(await call('tflash_consume_web_decision',[...owner,origin,'old-call']),false);
    assert.equal(await call('tflash_resolve_continuation',[...owner,attempt,row.review_revision,'I checked the remote effect and confirmed the turn stopped.']),true);
    assert.equal(await call('tflash_issue_web_decision',[...owner,origin,'old-call']),false,'old call cannot revive after release');
    assert.equal(await call('tflash_issue_web_decision',[...owner,origin,'new-call']),true);
    const newTask=(await db.query(`select revision from public.tflash_tracked_tasks where owner_id='alice'`)).rows[0].revision;
    const second=randomUUID(); assert.equal(await call('tflash_reserve_continuation',[...owner,newTask,second]),true);
    row=(await db.query(`select review_revision from public.tflash_task_continuation_attempts where attempt_id=$1`,[second])).rows[0];
    assert.equal(await call('tflash_begin_continuation',[...owner,second]),true);
    assert.equal(await call('tflash_resolve_continuation',[...owner,second,row.review_revision,'I reviewed before it began.']),false,'begin invalidates a stale reserved review');
    assert.equal(await call('tflash_hold_continuation',['supabase','bob','session',second,row.review_revision,'I checked the external service.']),false);
  } finally { await db.close(); }
});
