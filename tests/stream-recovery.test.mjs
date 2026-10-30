import test from "node:test";
import assert from "node:assert/strict";
import { streamReconnectDelay } from "../lib/stream-recovery.ts";

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
  assert.equal(streamReconnectDelay({ status: 429, headers: { "retry-after": "invalid" } }, 0), undefined);
  assert.equal(streamReconnectDelay({ status: 503, headers: { "retry-after": "Wed, 21 Oct 2015 07:28:10 GMT" } }, 0, () => 0, Date.parse("2015-10-21T07:28:00Z")), 10_000);
});
