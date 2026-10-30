import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { EventEmitter } from "node:events";
let answers = [{ address: "8.8.8.8", family: 4 }],
  status = 200,
  calls = [];
globalThis.__safeDns = async () => answers;
globalThis.__safeRequest = (url, options, response) => {
  calls.push({ url, options });
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = (err) => {
    if (err) req.emit("error", err);
    return req;
  };
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = status;
    res.headers = {
      "content-type": "text/plain",
      location: "https://evil.example/private",
    };
    res.resume = () => {};
    response(res);
    if (status === 200) {
      res.emit("data", Buffer.from("hello"));
      res.emit("end");
    }
  };
  return req;
};
registerHooks({
  resolve(s, c, n) {
    if (s === "node:dns/promises")
      return {
        url: "data:text/javascript,export const lookup = (...args) => globalThis.__safeDns(...args)",
        shortCircuit: true,
      };
    if (s === "node:https")
      return {
        url: "data:text/javascript,export const request = (...args) => globalThis.__safeRequest(...args)",
        shortCircuit: true,
      };
    if (s.startsWith("@/"))
      return {
        url: new URL(`../${s.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    return n(s, c);
  },
});
const { publicAddress, fetchGrantedHomepage } = await import(
  "../lib/permission-web-fetch.ts"
);
test("granted homepage pins public DNS, fails closed on revoked grants and never follows redirects", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  calls = [];
  status = 200;
  answers = [{ address: "8.8.8.8", family: 4 }];
  assert.equal(
    (await fetchGrantedHomepage("https://example.com/")).content,
    "hello",
  );
  let pinned;
  calls[0].options.lookup("example.com", {}, (_e, a) => {
    pinned = a;
  });
  assert.equal(pinned, "8.8.8.8");
  await assert.rejects(
    fetchGrantedHomepage("https://example.com/", undefined, async () => false),
    /no longer active/,
  );
  assert.equal(calls.length, 1);
  status = 302;
  await assert.rejects(
    fetchGrantedHomepage("https://example.com/"),
    /Redirects require/,
  );
  assert.equal(calls.length, 2);
  answers = [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  await assert.rejects(
    fetchGrantedHomepage("https://example.com/"),
    /not public/,
  );
  assert.equal(calls.length, 2);
  await assert.rejects(
    fetchGrantedHomepage("https://example.com/private"),
    /outside/,
  );
});


test("cancellation while the pre-socket recheck stalls never starts the granted request", async () => {
  calls = [];
  answers = [{ address: "8.8.8.8", family: 4 }];
  const controller = new AbortController();
  let release, signalSeen;
  const gate = new Promise((resolve) => { release = resolve; });
  const result = fetchGrantedHomepage("https://example.com/", controller.signal, (signal) => { signalSeen = signal; return gate; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(signalSeen);
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(signalSeen.aborted, true);
  release(true);
  await gate;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});
