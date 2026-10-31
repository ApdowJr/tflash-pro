import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){
  if(specifier==='@/lib/identity')return {url:'data:text/javascript,export async function currentPrincipal(){return globalThis.__controlPrincipal}',shortCircuit:true};
  if(specifier==='@/lib/supabase/server')return {url:'data:text/javascript,export async function serverSupabase(){return globalThis.__controlSupabase()}',shortCircuit:true};
  if(specifier.startsWith('@/'))return {url:new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}});
process.env.TFLASH_SESSION_SECRET='local-session-secret-0123456789abcdef';
const {ownedChat}=await import('../lib/security/owned-chat.ts');
const {signChatOwnership}=await import('../lib/security/chat-ownership.ts');

test('control routes bind expected account before ownership reads and retain legacy compatibility',async()=>{
  const proof=signChatOwnership('alice','chat-a');let reads=0;
  globalThis.__controlSupabase=async()=>{reads++;return {from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{owner_proof:proof},error:null}}})}};
  const req=(headers={})=>new Request('https://app.test/api/chats/chat-a/task',{headers});
  globalThis.__controlPrincipal={id:'alice',kind:'supabase'};
  assert.equal(await ownedChat(req({'x-tflash-expected-user-id':'bob'}),'chat-a'),null);assert.equal(reads,0);
  assert.equal(await ownedChat(req({'x-tflash-expected-account-kind':'vercel'}),'chat-a'),null);assert.equal(reads,0);
  assert.equal((await ownedChat(req(),'chat-a')).userId,'alice');assert.equal(reads,1);
  globalThis.__controlPrincipal={id:'alice',kind:'vercel'};
  assert.equal(await ownedChat(req({'x-tflash-expected-account-kind':'supabase','x-tflash-owner-proof':proof}),'chat-a'),null);
  assert.equal((await ownedChat(req({'x-tflash-expected-account-kind':'vercel','x-tflash-owner-proof':proof}),'chat-a')).userId,'alice');
});
