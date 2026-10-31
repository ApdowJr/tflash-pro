import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { register } from 'tsx/esm/api';
const dom = new JSDOM('', { url: 'https://example.test' }); globalThis.window = dom.window; register();
const { beginSharedDispatch, sharedDispatchWarnings, clearOwnedSharedDispatch, clearReviewedSharedDispatch } = await import('../lib/shared-dispatch-recovery.ts');

test('shared dispatch markers are account/session scoped and contain no message', () => {
  window.localStorage.clear(); const key = beginSharedDispatch('supabase', 'alice', 'session-a');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), { sessionId: 'session-a' });
  assert.deepEqual(sharedDispatchWarnings('supabase', 'alice', 'session-a'), [{ key, raw: JSON.stringify({ sessionId: 'session-a' }) }]);
  assert.equal(sharedDispatchWarnings('supabase', 'alice', 'session-b').length, 0);
  assert.equal(sharedDispatchWarnings('supabase', 'bob', 'session-a').length, 0);
  assert.equal(sharedDispatchWarnings('vercel', 'alice', 'session-a').length, 0);
  assert.throws(() => beginSharedDispatch('supabase', 'alice', 'with spaces'));
  clearOwnedSharedDispatch(key, 'session-a'); assert.equal(window.localStorage.getItem(key), null);
});

test('malformed records block the account and automatic cleanup cannot erase a changed marker', () => {
  window.localStorage.clear(); const key = beginSharedDispatch('supabase', 'alice', 'session-a');
  window.localStorage.setItem(key, 'malformed'); assert.deepEqual(sharedDispatchWarnings('supabase', 'alice', 'session-b'), [{ key, raw: 'malformed' }]);
  assert.throws(() => clearOwnedSharedDispatch(key, 'session-a'));
  assert.equal(window.localStorage.getItem(key), 'malformed'); clearReviewedSharedDispatch(key, 'malformed');
  assert.equal(sharedDispatchWarnings('supabase', 'alice', 'session-b').length, 0);
});
