import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
registerHooks({ resolve(s,c,next) {
  if (s === "@/lib/security/owned-chat") return {url:"data:text/javascript,export const ownedChat=async(req,id)=>id==='session-a'&&req.headers.get('x-test-user')==='alice'?{kind:'supabase',userId:'alice'}:null",shortCircuit:true};
  if (s.startsWith("@/")) return {url:new URL(`../${s.slice(2)}.ts`,import.meta.url).href,shortCircuit:true};
  return next(s,c);
} });
const route = await import("../app/api/chats/[sessionId]/task/continuations/route.ts");

test("real continuation route, Supabase HTTP client and SQL do not redispatch uncertain reservations", async () => {
  const db = new PGlite(); let server;
  const previousUrl=process.env.TFLASH_PERMISSIONS_SUPABASE_URL, previousKey=process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY;
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["20261030120000_create_tflash_permission_grants.sql","20261030130000_permission_grant_revisions.sql","20261030140000_permission_emergency_revocation.sql","20261030150000_permission_call_decisions.sql","20261030160000_task_continuation_attempts.sql","20261030170000_continuation_review_fencing.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
    const revision=randomUUID();
    await db.query(`insert into public.tflash_tracked_tasks values ('supabase','alice','session-a',$1,'test task','out.txt',$2,1,'awaiting_evidence',null,null)`,[revision,'a'.repeat(64)]);
    const rpc = {
      tflash_reserve_continuation:['p_kind','p_owner','p_session','p_revision','p_attempt'],
      tflash_begin_continuation:['p_kind','p_owner','p_session','p_attempt'],
      tflash_hold_continuation:['p_kind','p_owner','p_session','p_attempt','p_expected','p_note'],
      tflash_resolve_continuation:['p_kind','p_owner','p_session','p_attempt','p_expected','p_note'],
    };
    server=createServer(async(req,res)=>{
      try {
        const url=new URL(req.url,'http://localhost'); res.setHeader('content-type','application/json');
        if(url.pathname.startsWith('/rest/v1/rpc/')) {
          const name=url.pathname.split('/').at(-1), keys=rpc[name]; if(!keys) throw new Error('unexpected rpc');
          let raw=''; for await (const chunk of req) raw+=chunk; const payload=JSON.parse(raw);
          const result=await db.query(`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) as value`,keys.map(k=>payload[k]));
          res.end(JSON.stringify(result.rows[0].value)); return;
        }
        if (url.pathname==='/rest/v1/tflash_task_continuation_attempts') {
          const state=url.searchParams.get('state'), reviewed=state==='eq.reviewed';
          const result=await db.query(`select attempt_id,state,created_at,reviewed_at,review_note,review_revision,hold_note,hold_at from public.tflash_task_continuation_attempts where owner_kind=$1 and owner_id=$2 and session_id=$3 and ${reviewed ? "state='reviewed'" : "state in ('reserved','dispatching')"} order by created_at desc limit 20`,['supabase','alice','session-a']);
          const singular=req.headers.accept?.includes('application/vnd.pgrst.object+json');
          res.end(JSON.stringify(singular ? result.rows[0] ?? null : result.rows)); return;
        }
        res.statusCode=404; res.end('{}');
      } catch(error) { res.statusCode=500; res.end(JSON.stringify({message:String(error)})); }
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    process.env.TFLASH_PERMISSIONS_SUPABASE_URL=`http://127.0.0.1:${server.address().port}`;
    process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY='local-test-only';
    const context={params:Promise.resolve({sessionId:'session-a'})};
    const request=(method,body,user='alice',origin='https://tflash.test')=>new Request('https://tflash.test/api/chats/session-a/task/continuations',{method,headers:{origin,'x-test-user':user,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const id=randomUUID(), data={action:'reserve',attemptId:id,revision};
    assert.equal((await route.POST(request('POST',data,'bob'),context)).status,404);
    assert.equal((await route.POST(request('POST',data,'alice','https://other.test'),context)).status,403);
    assert.equal((await route.POST(request('POST',data),context)).status,200);
    const conflict=await route.POST(request('POST',data),context);
    assert.equal(conflict.status,409); assert.equal((await conflict.json()).continuationNotStarted,true);
    let snapshot=await (await route.GET(request('GET'),context)).json();
    assert.equal(snapshot.attempt.attemptId,id); assert.equal(snapshot.attempt.state,'reserved');
    const reservedRevision=snapshot.attempt.reviewRevision;
    assert.equal((await route.POST(request('POST',{action:'begin',attemptId:id}),context)).status,200);
    assert.equal((await route.POST(request('POST',{action:'begin',attemptId:id}),context)).status,409);
    assert.equal((await route.POST(request('POST',{action:'resolve',attemptId:id,expectedRevision:reservedRevision,reviewed:true,note:'Checked the external service.'}),context)).status,409);
    snapshot=await (await route.GET(request('GET'),context)).json();
    assert.notEqual(snapshot.attempt.reviewRevision,reservedRevision);
    assert.equal((await route.POST(request('POST',{action:'hold',attemptId:id,expectedRevision:snapshot.attempt.reviewRevision,note:'The external effect remains unknown.'}),context)).status,200);
    assert.equal((await route.POST(request('POST',{action:'resolve',attemptId:id,expectedRevision:snapshot.attempt.reviewRevision,reviewed:true,note:'Checked the external service.'}),context)).status,409);
    snapshot=await (await route.GET(request('GET'),context)).json();
    assert.equal(snapshot.attempt.holdNote,'The external effect remains unknown.');
    assert.equal((await route.POST(request('POST',{action:'resolve',attemptId:id,expectedRevision:snapshot.attempt.reviewRevision,reviewed:true,note:'short'}),context)).status,400);
    assert.equal((await route.POST(request('POST',{action:'resolve',attemptId:id,expectedRevision:snapshot.attempt.reviewRevision,reviewed:true,note:'Confirmed the service outcome.'}),context)).status,200);
    snapshot=await (await route.GET(request('GET'),context)).json();
    assert.equal(snapshot.attempt,null); assert.equal(snapshot.history[0].note,'Confirmed the service outcome.');
    assert.equal((await route.POST(request('POST',{action:'review',attemptId:id,reviewed:true,note:'Legacy action is not allowed.'}),context)).status,400);
    const oversized=request('POST',{padding:'x'.repeat(5000)});
    assert.equal((await route.POST(oversized,context)).status,413);
    const row=(await db.query(`select continuation_budget from public.tflash_tracked_tasks where owner_id='alice'`)).rows[0]; assert.equal(row.continuation_budget,0);
  } finally {
    if(previousUrl===undefined) delete process.env.TFLASH_PERMISSIONS_SUPABASE_URL; else process.env.TFLASH_PERMISSIONS_SUPABASE_URL=previousUrl;
    if(previousKey===undefined) delete process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY; else process.env.TFLASH_PERMISSIONS_SERVICE_ROLE_KEY=previousKey;
    if(server) {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));} await db.close();
  }
});
