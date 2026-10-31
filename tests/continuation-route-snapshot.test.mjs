import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){
  if(s==='@/lib/security/owned-chat')return {url:'data:text/javascript,export async function ownedChat(){return {kind:"supabase",userId:"alice"}}',shortCircuit:true};
  if(s==='@/lib/continuation-store')return {url:'data:text/javascript,export async function pendingContinuation(){return globalThis.__snapshotAttempt};export async function reviewedContinuations(){return globalThis.__snapshotHistory};export async function continuationMutation(){if(globalThis.__mutationThrows)throw new Error("private detail");return false}',shortCircuit:true};
  if(s.startsWith('@/'))return {url:new URL(`../${s.slice(2)}.ts`,import.meta.url).href,shortCircuit:true};
  return next(s,c);
}});
const route=await import('../app/api/chats/[sessionId]/task/continuations/route.ts');
const context={params:Promise.resolve({sessionId:'chat-a'})};
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',date='2026-10-31T00:00:00Z';
const req=(method,body)=>new Request('https://app.test/api/chats/chat-a/task/continuations',{method,headers:{origin:'https://app.test',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});

test('route fails closed on malformed or contradictory continuation reads',async()=>{
  globalThis.__snapshotAttempt={attemptId:id,reviewRevision:revision,state:'dispatching',createdAt:date,holdNote:null,holdAt:null};
  globalThis.__snapshotHistory=[{attemptId:id,reviewedAt:date,note:'Private review note.'}];
  let result=await route.GET(req('GET'),context);assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/Private review note/);
  globalThis.__snapshotHistory=[null];result=await route.GET(req('GET'),context);assert.equal(result.status,503);
  globalThis.__snapshotAttempt=null;globalThis.__snapshotHistory=[];result=await route.GET(req('GET'),context);assert.deepEqual(await result.json(),{attempt:null,history:[]});
});

test('route marks actual CAS rejection, but never marks database uncertainty as not started',async()=>{
  const body={action:'reserve',attemptId:id,revision};globalThis.__mutationThrows=false;
  let result=await route.POST(req('POST',body),context);assert.equal(result.status,409);assert.equal((await result.json()).continuationNotStarted,true);
  globalThis.__mutationThrows=true;result=await route.POST(req('POST',body),context);assert.equal(result.status,503);const json=await result.json();assert.equal(json.continuationNotStarted,undefined);assert.doesNotMatch(JSON.stringify(json),/private detail/);
});
