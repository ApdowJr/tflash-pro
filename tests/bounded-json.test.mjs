import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/')) return next(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,context);
  return next(specifier,context);
}});
const {readBoundedJson}=await import('../lib/bounded-json.ts');
const make=(stream,signal,headers={})=>new Request('http://localhost/',{method:'POST',body:stream,duplex:'half',signal,headers});

test('bounded JSON reads bytes incrementally, cancels overflow and rejects malformed UTF-8',async()=>{
  let cancelled=false, pulls=0;
  const stream=new ReadableStream({pull(controller){pulls++; controller.enqueue(new TextEncoder().encode('x'.repeat(4097)));},cancel(){cancelled=true;}});
  const result=await readBoundedJson(make(stream));
  assert.equal(result.status,413); assert.equal(cancelled,true); assert.ok(pulls<=2);
  const bad=new ReadableStream({start(c){c.enqueue(new Uint8Array([0x7b,0xff,0x7d])); c.close();}});
  assert.equal((await readBoundedJson(make(bad))).status,400);
  const unicode=JSON.stringify({text:'é'.repeat(2048)});
  assert.equal((await readBoundedJson(new Request('http://localhost/',{method:'POST',body:unicode}))).status,413);
  assert.deepEqual(await readBoundedJson(new Request('http://localhost/',{method:'POST',body:'{"value":true}'})),{ok:true,value:{value:true}});
});

test('an aborted request does not wait for an uncooperative stream',async()=>{
  const controller=new AbortController(); let cancelled=false;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});
  const pending=readBoundedJson(make(stream,controller.signal));
  controller.abort();
  assert.equal((await pending).status,400); assert.equal(cancelled,true);
});
