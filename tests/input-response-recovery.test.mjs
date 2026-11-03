import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {register} from 'tsx/esm/api';
const dom=new JSDOM('',{url:'https://example.test'});globalThis.window=dom.window;register();
const {inputRequestDigest,beginInputResponse,inputResponseWarnings,resolvedInputRequestIds,clearInputResponse}=await import('../lib/input-response-recovery.ts');

test('human-input markers are scoped, secret-minimized and conservative when corrupt',async()=>{
  window.localStorage.clear();const digest=await inputRequestDigest('private-request-id');const key=beginInputResponse('vercel','alice','session-a',digest);
  assert.equal(inputResponseWarnings('vercel','alice','session-a').length,1);
  assert.equal(inputResponseWarnings('vercel','alice','session-b').length,0);assert.equal(inputResponseWarnings('supabase','alice','session-a').length,0);
  assert.doesNotMatch(window.localStorage.getItem(key),/private-request-id|approve|secret/);
  assert.throws(()=>beginInputResponse('vercel','alice','session-a',digest));
  window.localStorage.setItem(key,'bad');assert.equal(inputResponseWarnings('vercel','alice','session-b').length,1);
  clearInputResponse(key);assert.equal(inputResponseWarnings('vercel','alice','session-a').length,0);
});

test('only terminal interaction.settled records identify a settled response',()=>{
  const events=[{type:'response.submitted',data:{interactionId:'a',responseId:'r'}},
    {type:'interaction.settled',data:{interactionId:'b',outcome:'accepted'}},
    {type:'interaction.settled',data:{interactionId:'c',outcome:'accepted'}},
    {type:'interaction.settled',data:{interactionId:'b',outcome:'declined'}},
    {type:'interaction.settled',data:{interactionId:'c',outcome:'bogus'}},
    {type:'interaction.settled',data:null},{type:'interaction.settled',data:{interactionId:'d'}},
    {type:'interaction.settled',data:{interactionId:'e',outcome:'expired'}}];
  assert.deepEqual(resolvedInputRequestIds(events),['e','b','c']);
});
