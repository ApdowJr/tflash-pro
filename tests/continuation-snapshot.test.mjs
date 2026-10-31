import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const {parseContinuationSnapshot}=await import('../lib/continuation-snapshot.ts');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', date='2026-10-31T01:02:03.000Z';
const attempt={attemptId:id,reviewRevision:revision,state:'reserved',createdAt:date,holdNote:null,holdAt:null};
const history={attemptId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',reviewedAt:date,note:'Checked external service.'};

test('continuation snapshots accept bounded complete ledger data and reject partial or contradictory data',()=>{
  assert.deepEqual(parseContinuationSnapshot({attempt:null,history:[]}),{attempt:null,history:[]});
  assert.ok(parseContinuationSnapshot({attempt,history:[history]}));
  const bad=[{},[],{attempt:null},{history:[]},{attempt:null,history:[null]},
    {attempt:{...attempt,attemptId:'not-a-uuid'},history:[]},
    {attempt:{...attempt,reviewRevision:'bad'},history:[]},
    {attempt:{...attempt,createdAt:'not-a-date'},history:[]},
    {attempt:{...attempt,state:'reviewed'},history:[]},
    {attempt:{...attempt,holdNote:'some hold note',holdAt:null},history:[]},
    {attempt:{...attempt,holdNote:'x'.repeat(1001),holdAt:date},history:[]},
    {attempt:null,history:[{...history,note:'short'}]},
    {attempt:null,history:[{...history,reviewedAt:'bad'}]},
    {attempt:null,history:[history,history]},
    {attempt,history:[{...history,attemptId:id}]},
    {attempt:null,history:Array.from({length:21},()=>history)}];
  for(const input of bad) assert.equal(parseContinuationSnapshot(input),undefined,JSON.stringify(input));
});
