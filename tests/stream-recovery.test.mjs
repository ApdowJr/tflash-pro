import test from "node:test";
import assert from "node:assert/strict";
import { streamReconnectDelay } from "../lib/stream-recovery.ts";
import { ClientError } from "eve/client";

test("only plausibly transient stream failures are retried, with a bounded backoff", () => {
  const network = new TypeError("Failed to fetch");
  assert.deepEqual([0, 1, 2, 3].map((n) => streamReconnectDelay(network, n, () => 0)), [500, 1000, 2000, undefined]);
  assert.equal(streamReconnectDelay({ status: 401 }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 403 }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 409 }, 0), undefined);
  assert.equal(streamReconnectDelay(new Error("bad credentials"), 0), undefined);
  assert.equal(streamReconnectDelay({ name: "AbortError", status: 503 }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 503, headers: { "retry-after": "10" } }, 0, () => 0), 10_000);
  assert.equal(streamReconnectDelay({ status: 429, headers: { "retry-after": "31" } }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 429, headers: new Headers({ "Retry-After": "31" }) }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 503, headers: { "Retry-After": "10" } }, 0, () => 0), 10_000);
  assert.equal(streamReconnectDelay(new ClientError(503, "", { "Retry-After": "10" }), 0, () => 0), 10_000);
  assert.equal(streamReconnectDelay({ status: 503, headers: new Headers({ "Retry-After": "10" }) }, 0, () => 0), 10_000);
  for (const invalid of ["1.5", "-1", "2026-10-30", "Thu, 21 Oct 2015 07:28:10 GMT", "Wed, 32 Oct 2015 07:28:10 GMT"]) {
    assert.equal(streamReconnectDelay({ status: 503, headers: { "retry-after": invalid } }, 0), undefined, invalid);
  }
  assert.equal(streamReconnectDelay({ status: 503, headers: { get() { throw new Error("unreadable"); } } }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 503, headers: { "retry-after": "1", "Retry-After": "31" } }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 429, headers: { "retry-after": "invalid" } }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 503, headers: { "retry-after": "Wed, 21 Oct 2015 07:28:10 GMT" } }, 0, () => 0, Date.parse("2015-10-21T07:28:00Z")), 10_000);
});
