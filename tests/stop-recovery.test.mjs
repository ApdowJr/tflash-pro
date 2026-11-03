import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { register } from 'tsx/esm/api';
const dom = new JSDOM('', { url: 'https://example.test' }); globalThis.window = dom.window; register();
const { beginStop, stopWarnings, cancelledStopTurns, clearStop, isStopTurnId } = await import('../lib/stop-recovery.ts');

test('stop markers isolate accounts and sessions; malformed records fail closed', () => {
  window.localStorage.clear(); const key = beginStop('vercel', 'alice', 'session-a', 'turn-a');
  assert.deepEqual(stopWarnings('vercel', 'alice', 'session-a'), [{ key, turnId: 'turn-a' }]);
  assert.equal(stopWarnings('vercel', 'alice', 'session-b').length, 0);
  assert.equal(stopWarnings('supabase', 'alice', 'session-a').length, 0);
  assert.equal(stopWarnings('vercel', 'bob', 'session-a').length, 0);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), { sessionId: 'session-a', turnId: 'turn-a' });
  window.localStorage.setItem(key, 'corrupt'); assert.deepEqual(stopWarnings('vercel', 'alice', 'session-b'), [{ key }]);
  clearStop(key); assert.equal(stopWarnings('vercel', 'alice', 'session-a').length, 0);
  assert.throws(() => beginStop('vercel', 'alice', 'session-a', 'turn with spaces'));
  assert.equal(isStopTurnId('turn-a'), true); assert.equal(isStopTurnId(''), false);
});

test('only exact durable turn.settled cancellations can clear a scoped stop warning', () => {
  const events = [{ type: 'turn.settled', data: { turnId: 'a', outcome: 'completed' } },
    { type: 'turn.settled', data: { turnId: 'b', outcome: 'failed' } },
    { type: 'turn.settled', data: { turnId: 'c', outcome: 'cancelled' } },
    { type: 'turn.cancelled', data: { turnId: 'd' } },
    { type: 'turn.settled', data: { turnId: 'bad space', outcome: 'cancelled' } },
    { type: 'turn.settled', data: null }, { type: 'session.waiting', data: {} },
    { type: 'turn.settled', data: { turnId: 'still-open' } },
    { type: 'turn.settled', data: { turnId: 'e', outcome: 'cancelled' } }];
  assert.deepEqual([...cancelledStopTurns(events)], ['c', 'e']);
});
