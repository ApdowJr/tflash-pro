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

test('only terminal input.resolved records identify a settled response',()=>{
  const events=[{type:'client.input.responded',data:{resolutions:[{requestId:'a',kind:'tool-approval',outcome:'approved'}]}},
    {type:'input.resolved',data:{resolutions:[{requestId:'b',kind:'tool-approval',outcome:'approved'},{requestId:'c',kind:'question',outcome:'answered'},
      {requestId:'d',kind:'question',outcome:'pending'},null,{requestId:'e',kind:'unknown',outcome:'approved'}]}}];
  assert.deepEqual(resolvedInputRequestIds(events),['b','c']);
});
