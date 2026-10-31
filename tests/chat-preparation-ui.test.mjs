import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// Render the real composer and session-preparation component. Eve and HTTP
// are mocked; these tests never contact authentication, AI or storage services.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/", pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect", "History"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.PointerEvent = dom.window.MouseEvent;
globalThis.PointerEvent = dom.window.MouseEvent;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
dom.window.HTMLElement.prototype.setPointerCapture = () => {};
dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
register();
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "eve/react") {
    return { url: "data:text/javascript,export function useEveAgent(options) { globalThis.__prepareOptions = options; return globalThis.__prepareAgent; }", shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const React = await import("react");
const { render, screen, waitFor, cleanup, fireEvent, within } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");
const { AgentChat } = await import("../components/chat/agent-chat.tsx");
const h = React.createElement;
const realFetch = globalThis.fetch;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realSetTimeout = window.setTimeout;
const realClearTimeout = window.clearTimeout;
const account = { id: "prepare-user", kind: "supabase", name: "Test", email: "test@example.test" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function seed({ language = "en", agentStatus = "ready" } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem("tflash:language", language);
  window.localStorage.setItem("tflash:settings:v1:prepare-user", JSON.stringify({ language }));
  const sends = [];
  globalThis.__prepareAgent = {
    status: agentStatus, events: [], data: { messages: [], inputs: {} },
    send: async (message, options) => { sends.push({ message, options }); },
    respond: async () => {}, cancel: async () => {},
  };
  return sends;
}
function app(props = {}, kind = "supabase") {
  return h(AppSettingsProvider, { userId: account.id, accountKind: kind },
    h(TooltipProvider, null, h(AgentChat, { account: { ...account, kind }, sessionless: true, ...props })));
}
function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    const response = await handler(path, options);
    if (response) return response;
    if (path === "/api/providers") return Response.json({ providers: [] });
    if (path === "/api/integrations") return Response.json({ integrations: [] });
    if (path === "/api/workspace") {
      if (options.method === "PUT") return Response.json({ ok: true, storage: "cloud", updatedAt: "2026-10-29T12:00:00.000Z" });
      return Response.json({ storage: "cloud", workspace: null, updatedAt: null });
    }
    if (path === "/api/chats" && !options.method) return Response.json({ chats: [], storage: "account" });
    if (path.startsWith("/api/chats/") && options.method === "PATCH") {
      return Response.json({ ok: true, title: JSON.parse(options.body).title });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return calls;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
  window.setTimeout = realSetTimeout;
  window.clearTimeout = realClearTimeout;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  delete globalThis.__prepareAgent;
  delete globalThis.__prepareOptions;
});

test("draft survives preparation, forced submission, a storage failure, retry and session remount", async () => {
  const sends = seed();
  const first = deferred();
  const second = deferred();
  let creates = 0;
  const calls = fakeFetch((path, options) => {
    if (path === "/api/chats" && options.method === "POST") return (++creates === 1 ? first : second).promise;
  });
  render(h(React.StrictMode, null, app()));
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await waitFor(() => assert.equal(creates, 1));
  assert.equal(textarea.disabled, false);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.ok(screen.getByText("Preparing conversation…"));
  await user.type(textarea, "Please keep my draft");
  await user.keyboard("{Enter}");
  assert.equal(textarea.value, "Please keep my draft");
  assert.equal(sends.length, 0);

  // Even a synthetic submission cannot clear or send an unowned draft.
  fireEvent.submit(textarea.closest("form"));
  await waitFor(() => assert.equal(textarea.value, "Please keep my draft"));
  assert.equal(sends.length, 0);

  await React.act(async () => first.resolve(Response.json({ code: "CHAT_STORAGE_SETUP_REQUIRED", creationNotStarted: true, error: "private diagnostic" }, { status: 503 })));
  assert.match((await screen.findByRole("alert")).textContent, /Chat storage is not configured/);
  assert.equal(screen.queryByText("private diagnostic"), null);
  assert.equal(textarea.disabled, false);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => assert.equal(creates, 2));
  assert.ok(screen.getByText("Preparing conversation…"));
  await user.type(textarea, " safely");
  assert.equal(sends.length, 0);

  await React.act(async () => second.resolve(Response.json({ sessionId: "ready-chat" }, { status: 201 })));
  const readyTextarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(readyTextarea.value, "Please keep my draft safely");
  assert.equal(globalThis.__prepareOptions.initialSession.sessionId, "ready-chat");
  assert.equal(sends.length, 0, "becoming ready must not send automatically");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(sends.length, 1));
  assert.equal(sends[0].message, "Please keep my draft safely");
  assert.equal(calls.filter((call) => call.path === "/api/chats/ready-chat" && call.options.method === "PATCH").length, 1);
});

test("Somali storage and authentication failures have understandable messages and never enable Send", async () => {
  const sends = seed({ language: "so" });
  let creates = 0;
  fakeFetch((path, options) => {
    if (path === "/api/chats" && options.method === "POST") {
      creates++;
      if (creates === 1) return Response.json({ code: "CHAT_STORAGE_UNAVAILABLE", creationNotStarted: true }, { status: 503 });
      return Response.json({ error: "some private backend error" }, { status: 401 });
    }
  });
  render(app());
  const user = userEvent.setup();
  assert.match((await screen.findByRole("alert")).textContent, /Wada hadalka lama kaydin karin/);
  const textarea = screen.getByPlaceholderText("Wax walba weydii Tflash…");
  await user.type(textarea, "Salaan");
  assert.equal(screen.getByRole("button", { name: "Dir" }).disabled, true);
  await user.click(screen.getByRole("button", { name: "Mar kale isku day" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /Mar kale soo gal/));
  assert.equal(textarea.value, "Salaan");
  assert.equal(screen.queryByText("some private backend error"), null);
  assert.equal(sends.length, 0);
});

test("a stalled creation times out and leaves the editable draft for retry", async () => {
  const sends = seed();
  let expire;
  window.setTimeout = (handler, delay, ...args) => {
    if (delay === 65_000) { expire = handler; return 99999; }
    return realSetTimeout(handler, delay, ...args);
  };
  window.clearTimeout = (id) => { if (id !== 99999) realClearTimeout(id); };
  fakeFetch((path, options) => {
    if (path === "/api/chats" && options.method === "POST") {
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
  });
  render(app());
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Still here");
  await waitFor(() => assert.equal(typeof expire, "function"));
  await React.act(async () => expire());
  assert.match((await screen.findByRole("alert")).textContent, /A previous conversation may have been created/);
  assert.equal(textarea.value, "Still here");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(sends.length, 0);
});

test("resuming an existing conversation keeps drafts and blocks forced sends until it is ready", async () => {
  const sends = seed({ agentStatus: "resuming" });
  fakeFetch(() => undefined);
  const view = render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await waitFor(() => assert.equal(globalThis.__prepareOptions.initialSession?.sessionId, "owned-chat"));
  await user.type(textarea, "Continue later");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  fireEvent.submit(textarea.closest("form"));
  await waitFor(() => assert.equal(textarea.value, "Continue later"));
  assert.equal(sends.length, 0);
  globalThis.__prepareAgent.status = "ready";
  view.rerender(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(textarea.value, "Continue later");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(sends.length, 1));
  assert.equal(sends[0].message, "Continue later");
});

test("attachments survive an unavailable session and are only sent after registration", async () => {
  const sends = seed();
  const pending = deferred();
  const blobs = new Map();
  URL.createObjectURL = (file) => { const url = `blob:test-${blobs.size}`; blobs.set(url, file); return url; };
  URL.revokeObjectURL = () => {};
  fakeFetch((path, options) => {
    if (path === "/api/chats" && options.method === "POST") return pending.promise;
    if (path.startsWith("blob:")) return { blob: async () => blobs.get(path) };
  });
  render(app());
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Describe this");
  await user.upload(screen.getByLabelText("Upload files"), new File(["fixture"], "draft.png", { type: "image/png" }));
  await screen.findByRole("button", { name: "Remove attachment: draft.png" });
  fireEvent.submit(textarea.closest("form"));
  await waitFor(() => assert.equal(textarea.value, "Describe this"));
  assert.ok(screen.getByRole("button", { name: "Remove attachment: draft.png" }));
  assert.equal(sends.length, 0);
  await React.act(async () => pending.resolve(Response.json({ sessionId: "attachment-chat" }, { status: 201 })));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(screen.getByPlaceholderText("Ask Tflash anything…").value, "Describe this");
  assert.ok(screen.getByRole("button", { name: "Remove attachment: draft.png" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(sends.length, 1));
  assert.ok(sends[0].message.some((part) => part.type === "text" && part.text === "Describe this"));
  assert.ok(sends[0].message.some((part) => part.type === "file" && part.filename === "draft.png" && part.data.startsWith("data:image/png;base64,")));
});

test("a Vercel conversation cannot become ready without its owner proof", async () => {
  const sends = seed();
  let creates = 0;
  fakeFetch((path, options) => {
    if (path === "/api/chats" && options.method === "POST") {
      creates++;
      if (creates === 1) return Response.json({ sessionId: "unowned" }, { status: 201 });
      return Response.json({ sessionId: "owned", ownerProof: "test-owner-proof" }, { status: 201 });
    }
  });
  render(app({}, "vercel"));
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Secure draft");
  assert.match((await screen.findByRole("alert")).textContent, /A previous conversation may have been created/);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(sends.length, 0);
  await user.click(screen.getByRole("checkbox", { name: /I checked what I can/ }));
  await user.click(screen.getByRole("button", { name: "Acknowledge and start a new conversation" }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(screen.getByPlaceholderText("Ask Tflash anything…").value, "Secure draft");
  assert.equal(globalThis.__prepareOptions.initialSession.sessionId, "owned");
  assert.equal(globalThis.__prepareOptions.headers()["x-tflash-owner-proof"], "test-owner-proof");
  assert.equal(sends.length, 0);
});

test("follow-ups can still steer an active turn once the session is ready", async () => {
  const sends = seed({ agentStatus: "streaming" });
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await waitFor(() => assert.equal(globalThis.__prepareOptions.initialSession?.sessionId, "owned-chat"));
  const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Correct the answer");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(sends.length, 1));
  assert.equal(sends[0].message, "Correct the answer");
  assert.equal(sends[0].options.turnPolicy, "steer");
});


test("stop remains available while typing a follow-up and blocks steering until cancellation settles", async () => {
  const sends = seed({ agentStatus: "streaming" });
  const cancellation = deferred();
  let cancels = 0;
  globalThis.__prepareAgent.cancel = () => { cancels++; return cancellation.promise; };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await waitFor(() => assert.equal(globalThis.__prepareOptions.initialSession?.sessionId, "owned-chat"));
  const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Keep this draft");
  assert.ok(screen.getByRole("button", { name: "Send" }));
  await user.click(screen.getByRole("button", { name: "Stop" }));
  assert.equal(cancels, 1);
  assert.equal(screen.getByRole("button", { name: "Stopping…" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(sends.length, 0);
  assert.equal(textarea.value, "Keep this draft");
  await React.act(async () => { cancellation.resolve(); await cancellation.promise; });
});

test("a disconnected active turn offers reconnection rather than continuing blindly", async () => {
  const sends = seed({ agentStatus: "error" });
  let resumes = 0;
  globalThis.__prepareAgent.data.activeTurnId = "turn-a";
  globalThis.__prepareAgent.data.turns = { "turn-a": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await waitFor(() => assert.equal(globalThis.__prepareOptions.initialSession?.sessionId, "owned-chat"));
  assert.ok(screen.getByText(/stream disconnected while a turn was active/));
  await user.type(screen.getByPlaceholderText("Ask Tflash anything…"), "Keep this draft");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  assert.equal(resumes, 1);
  assert.equal(sends.length, 0);
});

test("stopping during chat-index persistence prevents the pending follow-up from being scheduled", async () => {
  const sends = seed({ agentStatus: "streaming" });
  const save = deferred();
  let cancels = 0;
  globalThis.__prepareAgent.cancel = async () => { cancels++; };
  fakeFetch((path, options) => {
    if (path === "/api/chats/owned-chat" && options.method === "PATCH") return save.promise;
  });
  render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await waitFor(() => assert.equal(globalThis.__prepareOptions.initialSession?.sessionId, "owned-chat"));
  await user.type(screen.getByPlaceholderText("Ask Tflash anything…"), "Do not send after stopping");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(screen.getByRole("button", { name: "Stop" }));
  assert.equal(cancels, 1);
  await React.act(async () => { save.resolve(Response.json({ ok: true })); await save.promise; });
  await waitFor(() => assert.equal(screen.getByPlaceholderText("Ask Tflash anything…").value, "Do not send after stopping"));
  assert.equal(sends.length, 0);
});

test("task panel distinguishes a stopped turn from the agent-reported plan and ignores a stale prior failure", async () => {
  seed();
  const plan = { title: "Build feature", steps: [{ id: "one", title: "Implement", status: "in_progress" }, { id: "two", title: "Test", status: "pending" }] };
  globalThis.__prepareAgent.data.messages = [{ id: "m", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "update_plan", toolCallId: "p", state: "output-available", output: { kind: "tflash-plan", version: 1, plan } }] }];
  globalThis.__prepareAgent.events = [
    { type: "turn.started", data: { turnId: "new", sequence: 2 } },
    { type: "turn.cancelled", data: { turnId: "new", sequence: 2 } },
    { type: "turn.failed", data: { turnId: "old", sequence: 1, code: "FAILURE", message: "stale error" } },
  ];
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.ok(screen.getByText("Turn stopped")));
  assert.ok(screen.getByText(/The turn stopped before finishing/));
  assert.equal(screen.getAllByText(/0\/2 Completed · reported by agent/).length, 2);
  assert.equal(screen.queryByText("stale error"), null);
});

test("an open input is shown as waiting, not as an idle resumable task", async () => {
  seed();
  const plan = { title: "Build feature", steps: [{ id: "one", title: "Implement", status: "pending" }] };
  globalThis.__prepareAgent.data.messages = [{ id: "m", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "update_plan", toolCallId: "p", state: "output-available", output: { kind: "tflash-plan", version: 1, plan } }] }];
  globalThis.__prepareAgent.data.inputs = { input: { status: "open", request: { kind: "tool-approval", action: { callId: "other" } } } };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.ok(screen.getByText("Waiting for you")));
  assert.equal(screen.queryByRole("button", { name: "Continue task" }), null);
});

test("transient stream failures reconnect with a bounded budget without sending a new turn", async () => {
  const sends = seed({ agentStatus: "error" });
  let resumes = 0;
  globalThis.__prepareAgent.error = new TypeError("Failed to fetch");
  globalThis.__prepareAgent.data.activeTurnId = "turn-a";
  globalThis.__prepareAgent.data.turns = { "turn-a": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  await screen.findByText(/stream disconnected while a turn was active/);
  await waitFor(() => assert.equal(resumes, 3), { timeout: 6500 });
  await screen.findByText(/Automatic reconnection stopped/);
  assert.equal(sends.length, 0);
  assert.ok(screen.getByRole("button", { name: "Reconnect" }));
});

test("permanent stream failures do not automatically reconnect", async () => {
  const sends = seed({ agentStatus: "error" });
  let resumes = 0;
  globalThis.__prepareAgent.error = Object.assign(new Error("Unauthorized"), { status: 401 });
  globalThis.__prepareAgent.data.activeTurnId = "turn-a";
  globalThis.__prepareAgent.data.turns = { "turn-a": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  await screen.findByText(/stream disconnected while a turn was active/);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(resumes, 0);
  assert.equal(sends.length, 0);
  assert.ok(screen.getByRole("button", { name: "Reconnect" }));
});

test("a stale active-turn projection cannot trigger auto-reconnect after a durable cancellation", async () => {
  seed({ agentStatus: "error" });
  let resumes = 0;
  globalThis.__prepareAgent.error = new TypeError("Failed to fetch");
  globalThis.__prepareAgent.events = [
    { type: "turn.started", data: { turnId: "turn-a", sequence: 1 } },
    { type: "turn.cancelled", data: { turnId: "turn-a", sequence: 1 } },
  ];
  globalThis.__prepareAgent.data.activeTurnId = "turn-a";
  globalThis.__prepareAgent.data.turns = { "turn-a": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  fakeFetch(() => undefined);
  render(app({ sessionId: "owned-chat" }));
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(resumes, 0);
  assert.equal(screen.queryByRole("button", { name: "Reconnect" }), null);
});

test("intermittent streaming does not reset the automatic retry budget for the same turn", async () => {
  seed({ agentStatus: "error" });
  let resumes = 0;
  globalThis.__prepareAgent.error = new TypeError("Failed to fetch");
  globalThis.__prepareAgent.data.activeTurnId = "turn-a";
  globalThis.__prepareAgent.data.turns = { "turn-a": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  fakeFetch(() => undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.equal(resumes, 1), { timeout: 2500 });
  globalThis.__prepareAgent.status = "streaming";
  rendered.rerender(app({ sessionId: "owned-chat" }));
  globalThis.__prepareAgent.status = "error";
  rendered.rerender(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.equal(resumes, 3), { timeout: 5000 });
  await screen.findByText(/Automatic reconnection stopped/);
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(resumes, 3);
});

test("a disconnected stop targets only the observed turn and reattaches to confirm", async () => {
  const sends = seed({ agentStatus: "error" });
  globalThis.__prepareAgent.data.activeTurnId = "turn-old";
  globalThis.__prepareAgent.data.turns = { "turn-old": { status: "active" } };
  let resumes = 0;
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  const pending = deferred(); let calls = 0, body, proof;
  fakeFetch((path, options) => {
    if (path.endsWith("/eve/v1/session/owned-chat/cancel")) {
      calls++; body = JSON.parse(options.body); proof = new Headers(options.headers).get("x-tflash-owner-proof");
      return pending.promise;
    }
  });
  window.localStorage.setItem("tflash:settings:v1:prepare-user", JSON.stringify({ language: "en", chatProofs: { "owned-chat": "proof-value" } }));
  render(app({ sessionId: "owned-chat" }, "vercel"));
  const user = userEvent.setup();
  const stop = await screen.findByRole("button", { name: "Request stop for this turn" });
  await user.click(stop);
  await waitFor(() => assert.equal(calls, 1)); assert.equal(body.turnId, "turn-old"); assert.equal(proof, "proof-value");
  assert.equal(screen.getByRole("button", { name: "Stopping…" }).disabled, true);
  assert.equal(sends.length, 0); assert.equal(resumes, 0);
  await React.act(async () => { pending.resolve(Response.json({ ok: true, status: "accepted", sessionId: "owned-chat" }, { status: 202 })); await pending.promise; });
  await waitFor(() => assert.equal(resumes, 1));
  assert.ok(screen.getByText(/stream disconnected while a turn was active/));
  assert.equal(sends.length, 0);
});

test("a failed disconnected stop preserves the draft and reports an error", async () => {
  const sends = seed({ agentStatus: "error" });
  globalThis.__prepareAgent.data.activeTurnId = "turn-old";
  globalThis.__prepareAgent.data.turns = { "turn-old": { status: "active" } };
  globalThis.__prepareAgent.resume = async () => {};
  fakeFetch((path) => path.endsWith("/eve/v1/session/owned-chat/cancel") ? Response.json({ error: "offline" }, { status: 503 }) : undefined);
  render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(input, "Keep my draft");
  await user.click(await screen.findByRole("button", { name: "Request stop for this turn" }));
  await waitFor(() => assert.ok(screen.getByText("offline")));
  assert.equal(input.value, "Keep my draft"); assert.equal(sends.length, 0);
  assert.ok(screen.getByText(/A stop request may have been accepted/));
  assert.equal(screen.getByRole("button", { name: "Stopping…" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "Reconnect" }).disabled, false);
});

test("a pending stop blocks scheduled reconnect and follow-ups until the turn settles", async () => {
  const sends = seed({ agentStatus: "error" });
  globalThis.__prepareAgent.error = new TypeError("Failed to fetch");
  globalThis.__prepareAgent.data.activeTurnId = "turn-old";
  globalThis.__prepareAgent.data.turns = { "turn-old": { status: "active" } };
  const pending = deferred(); const attached = deferred(); let resumes = 0;
  globalThis.__prepareAgent.resume = async () => { resumes++; await attached.promise; };
  // Hold the exact reconnect timer. Typing can take longer than its 500ms
  // delay on a loaded CI runner, before the user has even requested stop.
  let scheduledRetry;
  window.setTimeout = (handler, delay, ...args) => {
    if (delay >= 500 && delay <= 600 && typeof handler === "function") {
      scheduledRetry = () => handler(...args);
      return -12345;
    }
    return realSetTimeout(handler, delay, ...args);
  };
  window.clearTimeout = (timer) => { if (timer !== -12345) realClearTimeout(timer); };
  fakeFetch((path) => path.endsWith("/eve/v1/session/owned-chat/cancel") ? pending.promise : undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(input, "Do not send while stopping");
  await user.click(await screen.findByRole("button", { name: "Request stop for this turn" }));
  assert.equal(typeof scheduledRetry, "function");
  // Simulate a callback already queued when clearTimeout runs.
  await React.act(async () => scheduledRetry());
  assert.equal(resumes, 0, "the previously scheduled automatic retry must not race the stop request");
  await React.act(async () => { pending.resolve(Response.json({ ok: true, status: "accepted", sessionId: "owned-chat" }, { status: 202 })); await pending.promise; });
  await waitFor(() => assert.equal(resumes, 1));
  globalThis.__prepareAgent.status = "streaming";
  rendered.rerender(app({ sessionId: "owned-chat" }));
  await React.act(async () => { attached.resolve(); await attached.promise; });
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(input.value, "Do not send while stopping");
  assert.equal(sends.length, 0);
  globalThis.__prepareAgent.status = "ready";
  globalThis.__prepareAgent.events = [
    { type: "turn.started", data: { turnId: "turn-old", sequence: 1 } },
    { type: "turn.cancelled", data: { turnId: "turn-old", sequence: 1 } },
    { type: "session.waiting", data: {} },
  ];
  rendered.rerender(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(sends.length, 0);
});

test("accepted stop with a lost turn projection remains blocked but allows manual reattachment", async () => {
  const sends = seed({ agentStatus: "error" });
  globalThis.__prepareAgent.data.activeTurnId = "turn-old";
  globalThis.__prepareAgent.data.turns = { "turn-old": { status: "active" } };
  let resumes = 0;
  globalThis.__prepareAgent.resume = async () => { resumes++; throw new Error("offline"); };
  fakeFetch((path) => path.endsWith("/eve/v1/session/owned-chat/cancel") ? Response.json({ ok: true, status: "accepted", sessionId: "owned-chat" }, { status: 202 }) : undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(input, "Keep this draft");
  await user.click(await screen.findByRole("button", { name: "Request stop for this turn" }));
  await waitFor(() => assert.equal(resumes, 1));
  globalThis.__prepareAgent.status = "ready";
  globalThis.__prepareAgent.data.activeTurnId = undefined;
  globalThis.__prepareAgent.data.turns = {};
  rendered.rerender(app({ sessionId: "owned-chat" }));
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "Reconnect" }).disabled, false);
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  await waitFor(() => assert.equal(resumes, 2));
  assert.equal(input.value, "Keep this draft");
  assert.equal(sends.length, 0);
});

test("a stop response arriving after the terminal turn releases the composer", async () => {
  const sends = seed({ agentStatus: "streaming" });
  const pending = deferred();
  globalThis.__prepareAgent.data.activeTurnId = "turn-old";
  globalThis.__prepareAgent.data.turns = { "turn-old": { status: "active" } };
  fakeFetch(path => path.endsWith("/eve/v1/session/owned-chat/cancel") ? pending.promise : undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Ask Tflash anything…"), "Keep draft");
  await user.click(screen.getByRole("button", { name: "Stop" }));
  globalThis.__prepareAgent.status = "ready";
  globalThis.__prepareAgent.data.turns["turn-old"].status = "cancelled";
  globalThis.__prepareAgent.events = [{ type: "turn.cancelled", data: { turnId: "turn-old", sequence: 1 } }, { type: "session.waiting", data: {} }];
  rendered.rerender(app({ sessionId: "owned-chat" }));
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  await React.act(async () => { pending.resolve(Response.json({ ok: true, status: "accepted", sessionId: "owned-chat" }, { status: 202 })); await pending.promise; });
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
  assert.equal(sends.length, 0);
});

test("unrelated renders preserve reviewed continuation but a changed transcript requires review again", async () => {
  seed();
  const plan = { title: "Build feature", steps: [{ id: "one", title: "Implement", status: "pending" }] };
  const part = { type: "dynamic-tool", toolName: "update_plan", toolCallId: "p", state: "output-available", output: { kind: "tflash-plan", version: 1, plan } };
  globalThis.__prepareAgent.data.messages = [{ id: "m", role: "assistant", parts: [part] }];
  fakeFetch(() => undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  const user = userEvent.setup();
  await user.click((await screen.findAllByLabelText("Task plan")).find((element) => element.tagName === "SUMMARY"));
  await user.click(screen.getByRole("button", { name: "Continue task" }));
  const checkbox = screen.getByRole("checkbox", { name: /I reviewed the recent activity/ });
  await user.click(checkbox);
  rendered.rerender(app({ sessionId: "owned-chat" }));
  assert.equal(screen.getByRole("checkbox", { name: /I reviewed the recent activity/ }).checked, true);
  globalThis.__prepareAgent.data.messages = [{ id: "m", role: "assistant", parts: [{ ...part, output: { ...part.output, plan: { ...plan, title: "Revised feature" } } }] }];
  rendered.rerender(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.equal(screen.queryByRole("checkbox", { name: /I reviewed the recent activity/ }), null));
  assert.ok(screen.getByRole("button", { name: "Continue task" }));
});

test("turn projection is not rescanned on unrelated renders and updates on new events", async () => {
  seed(); let scans = 0;
  const initial = [{ type: "turn.started", data: { turnId: "turn-a", sequence: 1 } }];
  globalThis.__prepareAgent.events = new Proxy(initial, { get(target, prop, receiver) {
    if (prop === "forEach") return (...args) => { scans++; return target.forEach(...args); };
    return Reflect.get(target, prop, receiver);
  } });
  fakeFetch(() => undefined);
  const rendered = render(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.ok(scans > 0));
  const before = scans;
  rendered.rerender(app({ sessionId: "owned-chat" }));
  assert.equal(scans, before);
  globalThis.__prepareAgent.events = [...initial, { type: "turn.cancelled", data: { turnId: "turn-a", sequence: 1 } }];
  rendered.rerender(app({ sessionId: "owned-chat" }));
  await waitFor(() => assert.ok(screen.getByText(/The turn stopped before finishing/)));
});

test("an unacknowledged dispatch blocks retry across a tab reload until explicit review", async () => {
  const sends = seed();
  fakeFetch(() => undefined);
  let resumes = 0;
  globalThis.__prepareAgent.resume = async () => { resumes++; };
  // Eve's store reports stream/transport errors via onError and can resolve
  // send() rather than reject. Exercise that real callback contract.
  globalThis.__prepareAgent.send = async (message) => { sends.push({message}); globalThis.__prepareOptions.onError(new Error("connection lost")); };
  const view = render(app({sessionId:"owned-chat"}));
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText("Ask Tflash anything…");
  await user.type(input, "Do not repeat this");
  await user.keyboard("{Enter}");
  await screen.findByText(/A message dispatch may have reached the agent/);
  assert.equal(sends.length, 1);
  assert.equal(input.value, "Do not repeat this");
  fireEvent.submit(input.closest("form"));
  assert.equal(sends.length, 1);
  view.unmount();
  render(app({sessionId:"owned-chat"}));
  await screen.findByText(/A message dispatch may have reached the agent/);
  assert.equal(screen.getByRole("button", {name:"Finish review and allow a new message"}).disabled,true);
  await user.click(screen.getByRole("button", {name:"Reconnect"}));
  assert.equal(resumes,1);
  assert.equal(sends.length,1);
  await user.click(screen.getByRole("checkbox", {name:/I checked the turn/}));
  await user.click(screen.getByRole("button", {name:"Finish review and allow a new message"}));
  assert.equal(screen.queryByText(/A message dispatch may have reached the agent/),null);
  assert.equal(sends.length,1, "review never dispatches a turn itself");
});

test("an active turn can still be explicitly steered without erasing its dispatch marker", async () => {
  seed();
  fakeFetch(() => undefined);
  const original = deferred();
  const sent = [];
  globalThis.__prepareAgent.send = async (message, options) => { sent.push({message,options}); if (sent.length === 1) await original.promise; };
  const view = render(app({sessionId:"owned-chat"}));
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText("Ask Tflash anything…");
  await user.type(input,"First message");
  await user.keyboard("{Enter}");
  await waitFor(() => assert.equal(sent.length,1));
  globalThis.__prepareAgent.status = "streaming";
  view.rerender(app({sessionId:"owned-chat"}));
  await user.clear(input);
  await user.type(input,"Steer it");
  await user.keyboard("{Enter}");
  await waitFor(() => assert.equal(sent.length,2));
  assert.equal(sent[1].options.turnPolicy,"steer");
  assert.ok(window.sessionStorage.getItem("tflash:dispatch-review:v1:supabase:prepare-user:owned-chat"), "steer must not clear the original pending marker");
  await React.act(async () => original.resolve());
  await waitFor(() => assert.equal(window.sessionStorage.getItem("tflash:dispatch-review:v1:supabase:prepare-user:owned-chat"),null));
});

test("tracked manual continuation reserves and begins before the real chat send path", async () => {
  const sends=seed(); let attempt=null; const steps=[];
  const task={objective:'My objective',path:'out.txt',sha256:'a'.repeat(64),revision:'de208dd0-70ac-4a46-a010-7da9e62ae126',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  fakeFetch((path,options)=>{
    if(path.endsWith('/task')) return Response.json({task});
    if(!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return Response.json({attempt,history:[]});
    const input=JSON.parse(options.body); steps.push(input.action);
    if(input.action==='reserve') attempt={attemptId:input.attemptId,state:'reserved',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null};
    if(input.action==='begin') attempt={...attempt,state:'dispatching',reviewRevision:crypto.randomUUID()};
    return Response.json({ok:true});
  });
  globalThis.__prepareAgent.send=async(message,options)=>{steps.push('send');sends.push({message,options});};
  render(app({sessionId:'owned-chat'})); const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'More actions'}));
  await user.click(await screen.findByRole('menuitem',{name:'Settings'}));
  await user.click(screen.getByRole('tab',{name:'Workspace'}));
  await user.click(await screen.findByText('Track a file criterion'));
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));
  await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await waitFor(()=>assert.equal(sends.length,1));
  assert.deepEqual(steps,['reserve','begin','send']);
  assert.match(sends[0].message,new RegExp(`Tracked continuation attempt: ${attempt.attemptId}`));
  assert.match(sends[0].message,/not proof of execution or an idempotency key/);
  await screen.findByText(/Dispatch began but the outcome is unknown/);
});


test("conversation panels are removed from chat while permission revocation remains in settings", async () => {
  seed();
  globalThis.__prepareAgent.data.messages = [{id:'message-1',role:'user',parts:[{type:'text',text:'Hello'}]}];
  let revocations=0;
  fakeFetch((path,options)=>{
    if(path.endsWith('/permissions/revoke-all')) { revocations++; return Response.json({revoked:true}); }
    if(path.endsWith('/permissions')) return Response.json({epoch:crypto.randomUUID(),grants:[]});
  });
  render(app({sessionId:'owned-chat'}));
  const user=userEvent.setup();
  await screen.findAllByText('Hello');
  assert.equal(screen.queryByText('Permissions for this conversation'),null);
  assert.equal(screen.queryByText('Track a file criterion'),null);
  assert.equal(screen.queryByText('Activity & usage'),null);
  await user.click(screen.getByRole('button',{name:'More actions'}));
  await user.click(await screen.findByRole('menuitem',{name:'Settings'}));
  await user.click(screen.getByRole('tab',{name:'Workspace'}));
  await user.click(await screen.findByText('Permissions for this conversation'));
  await screen.findByText('No active reusable permissions.');
  await user.click(screen.getByRole('button',{name:'Revoke all reusable permissions'}));
  await screen.findByText(/Reusable permissions revoked/);
  assert.equal(revocations,1);
  assert.ok(screen.getByText('Track a file criterion'));
  assert.equal(screen.queryByText('Activity & usage'),null);
});


test("starter suggestions preserve an existing draft and never send automatically", async () => {
  const sends=seed(); fakeFetch(()=>undefined);
  render(app({sessionId:'owned-chat',sessionless:false}));
  const user=userEvent.setup();
  const input=await screen.findByRole('textbox',{name:'Message Tflash'});
  await user.type(input,'My own question');
  await user.click(screen.getByRole('button',{name:/Explain how APIs work, simply/}));
  assert.equal(input.value,'My own question Explain how APIs work, simply');
  await waitFor(()=>assert.equal(document.activeElement,input));
  assert.equal(sends.length,0);
});

test("Somali starter suggestions and composer are translated and preserve a draft", async () => {
  const sends=seed({language:'so'}); fakeFetch(()=>undefined);
  render(app({sessionId:'owned-chat',sessionless:false})); const user=userEvent.setup();
  const input=await screen.findByRole('textbox',{name:'Farriin u qor Tflash'});
  await user.type(input,'Qoraalkayga');
  await user.click(screen.getByRole('button',{name:/Sharax sida API-yadu u shaqeeyaan/}));
  assert.match(input.value,/^Qoraalkayga Sharax sida API-yadu/);
  assert.ok(screen.getByText('Qoraalkaaga ayuu ku daraa; si toos ah uma diro.'));
  assert.equal(sends.length,0);
});

test("copy action reports clipboard failure and success without unhandled rejection", async () => {
  seed(); fakeFetch(()=>undefined);
  globalThis.__prepareAgent.data.messages=[{id:'assistant-1',role:'assistant',parts:[{type:'text',text:'Useful answer'}]}];
  const previous=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  const user=userEvent.setup();
  let fail=true, copied;
  try {
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(fail) throw new Error('denied'); copied=text;}}});
    render(app({sessionId:'owned-chat'}));
    await user.click(await screen.findByRole('button',{name:'Copy'}));
    await screen.findByText('Could not copy. Please try again.');
    fail=false;
    await user.click(screen.getByRole('button',{name:'Copy'}));
    await screen.findByText('Copied');
    assert.equal(copied,'Useful answer');
  } finally {
    if(previous) Object.defineProperty(navigator,'clipboard',previous);
    else delete navigator.clipboard;
  }
});

for (const failure of ["callback", "rejection"]) {
  test(`uncertain ${failure} invalidates a concurrent steering submission waiting for history`, async () => {
    seed();
    const first = deferred();
    const history = deferred();
    let writes = 0;
    const sends = [];
    globalThis.__prepareAgent.send = async (message) => { sends.push(message); await first.promise; };
    fakeFetch((path, options) => {
      if (path === "/api/chats/owned-chat" && options.method === "PATCH") {
        writes++;
        return writes === 1 ? Response.json({ ok: true, title: "First" }) : history.promise;
      }
    });
    const view = render(app({ sessionId: "owned-chat" }));
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Ask Tflash anything…");
    await user.type(input, "First request");
    await user.keyboard("{Enter}");
    await waitFor(() => assert.equal(sends.length, 1));
    globalThis.__prepareAgent.status = "streaming";
    view.rerender(app({ sessionId: "owned-chat" }));
    await user.clear(input);
    await user.type(input, "Do not send after failure");
    await user.keyboard("{Enter}");
    await waitFor(() => assert.equal(writes, 2));
    await React.act(async () => {
      if (failure === "callback") { globalThis.__prepareOptions.onError(new Error("connection lost")); first.resolve(); }
      else first.reject(new Error("connection lost"));
      await first.promise.catch(() => {});
    });
    await screen.findByText(/A message dispatch may have reached the agent/);
    // Even an explicit review cannot make the pre-error queued submission new.
    globalThis.__prepareAgent.status = "ready";
    view.rerender(app({ sessionId: "owned-chat" }));
    await user.click(screen.getByRole("checkbox", { name: /I checked the turn/ }));
    await user.click(screen.getByRole("button", { name: "Finish review and allow a new message" }));
    await React.act(async () => { history.resolve(Response.json({ ok: true, title: "First" })); await history.promise; });
    assert.equal(sends.length, 1, "uncertain activity must never trigger the queued steering send");
    await waitFor(() => assert.ok(screen.getByText("Do not send after failure"), "queued text remains recoverable"));
    assert.equal(input.value, "First request");
  });
}

test("a blocked browser recovery marker is visible and does not hide an uncertain dispatch", async () => {
  const sends = seed();
  const storage = window.Storage.prototype;
  const original = storage.setItem;
  storage.setItem = function(key, value) {
    if (String(key).startsWith("tflash:dispatch-review:")) throw new Error("Storage blocked");
    return original.call(this, key, value);
  };
  try {
    globalThis.__prepareAgent.send = async (message) => { sends.push(message); globalThis.__prepareOptions.onError(new Error("lost")); };
    fakeFetch(() => undefined);
    render(app({ sessionId: "owned-chat" }));
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Ask Tflash anything…");
    await user.type(input, "Keep my draft");
    await user.keyboard("{Enter}");
    await screen.findByText(/could not save its dispatch recovery marker/);
    await screen.findByText(/A message dispatch may have reached the agent/);
    fireEvent.submit(input.closest("form"));
    assert.equal(sends.length, 1);
    await waitFor(() => assert.equal(input.value, "Keep my draft"));
  } finally { storage.setItem = original; }
});

test("reported model usage is available in Workspace settings without restoring the removed activity panel", async () => {
  seed();
  globalThis.__prepareAgent.events=[
    {type:'step.completed',data:{turnId:'turn',stepIndex:0,usage:{inputTokens:10,outputTokens:3,costUsd:0.1}}},
    {type:'step.completed',data:{turnId:'turn',stepIndex:1,usage:{inputTokens:20}}},
  ];
  fakeFetch(()=>undefined);
  render(app({sessionId:'owned-chat'}));
  const user=userEvent.setup();
  assert.equal(screen.queryByText('Reported model usage'),null);
  await user.click(screen.getByRole('button',{name:'More actions'}));
  await user.click(await screen.findByRole('menuitem',{name:'Settings'}));
  await user.click(screen.getByRole('tab',{name:'Workspace'}));
  assert.equal(screen.queryByText('Activity & usage'),null);
  await user.click(await screen.findByText('Reported model usage'));
  const dl=screen.getByText('Input tokens').closest('dl');
  assert.ok(within(dl).getByText('30'));
  assert.equal(within(dl).getAllByText('Not reported').length,2);
  assert.ok(screen.getByText(/Reported costs may omit unpriced calls/));
  assert.ok(screen.getByText(/does not prove task completion/));
});

test("uncertain activity save keeps the message draft and does not send or replay", async () => {
  const sends=seed();const oldTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,writes=0;fakeFetch((path,options)=>{
    if(path==='/api/chats/owned-chat'&&options.method==='PATCH'){writes++;signal=options.signal;return new Promise(()=>{});}
  });
  try {
    render(app({sessionId:'owned-chat'}));const user=userEvent.setup();
    const textarea=await screen.findByPlaceholderText('Ask Tflash anything…');await user.type(textarea,'Keep this message');
    await user.click(screen.getByRole('button',{name:'Send'}));await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await waitFor(()=>assert.equal(textarea.value,'Keep this message'));
    assert.equal(sends.length,0);assert.equal(writes,1);
    assert.ok(screen.getAllByText(/A chat action may have completed or may still finish/).length);
    await user.click(screen.getByRole('button',{name:'Send'}));
    await waitFor(()=>assert.equal(textarea.value,'Keep this message'));
    assert.equal(sends.length,0);assert.equal(writes,1);
  } finally {AbortSignal.timeout=oldTimeout;}
});

test("uncertain session creation blocks automatic replay across remount and requires human acknowledgment", async () => {
  const sends=seed();let expire,createCalls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  window.setTimeout=(handler,delay,...args)=>{if(delay===65_000){expire=handler;return 99999;}return realSetTimeout(handler,delay,...args);};
  window.clearTimeout=id=>{if(id!==99999)realClearTimeout(id);};
  fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){
    createCalls++;const headers=new Headers(options.headers);assert.equal(headers.get('x-tflash-expected-user-id'),'prepare-user');assert.equal(headers.get('x-tflash-expected-account-kind'),'supabase');
    return createCalls===1?pending:Response.json({sessionId:'second'},{status:201});
  }});
  const mounted=render(app());const user=userEvent.setup();const textarea=await screen.findByPlaceholderText('Ask Tflash anything…');
  await user.type(textarea,'Unsent draft');await waitFor(()=>assert.equal(createCalls,1));await React.act(async()=>expire());
  await screen.findByText(/A previous conversation may have been created/);assert.equal(textarea.value,'Unsent draft');
  assert.equal(screen.getByRole('button',{name:'Acknowledge and start a new conversation'}).disabled,true);
  // A late success is not used or interpreted as cancellation.
  await React.act(async()=>{release(Response.json({sessionId:'late'},{status:201}));await pending;});
  mounted.unmount();render(app());await screen.findByText(/A previous conversation may have been created/);
  assert.equal(createCalls,1);assert.equal(sends.length,0);
  await user.click(screen.getByRole('checkbox',{name:/I checked what I can/}));
  assert.equal(createCalls,1,'checking is not authorization to retry');
  await user.click(screen.getByRole('button',{name:'Acknowledge and start a new conversation'}));
  await waitFor(()=>assert.equal(createCalls,2));
  await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'second'));assert.equal(sends.length,0);
});

test("a stalled creation response JSON stays uncertain and does not resend", async () => {
  seed();let expire,calls=0;window.setTimeout=(handler,delay,...args)=>{if(delay===65_000){expire=handler;return 99999;}return realSetTimeout(handler,delay,...args);};
  window.clearTimeout=id=>{if(id!==99999)realClearTimeout(id);};
  fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){calls++;const response=Response.json({sessionId:'session'});response.json=()=>new Promise(()=>{});return response;}});
  render(app());await waitFor(()=>assert.equal(calls,1));await React.act(async()=>expire());
  await screen.findByText(/A previous conversation may have been created/);assert.equal(calls,1);
  assert.ok(Object.keys(window.localStorage).some(k=>k.startsWith('tflash:sync-uncertain:chat-create:')));
});

test("a late session response after unmount retains a recovery hold", async () => {
  seed();let creates=0,release;const pending=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return pending;}});
  const mounted=render(app());await waitFor(()=>assert.equal(creates,1));mounted.unmount();
  await React.act(async()=>{release(Response.json({sessionId:'late'},{status:201}));await pending;});
  render(app());await screen.findByText(/A previous conversation may have been created/);assert.equal(creates,1);
});

test("post-dispatch storage failure remains uncertain rather than exposing an ordinary retry", async () => {
  seed();let creates=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({code:'CHAT_STORAGE_UNAVAILABLE'},{status:503});}});
  render(app());await screen.findByText(/A previous conversation may have been created/);
  assert.equal(creates,1);assert.equal(screen.queryByRole('button',{name:'Retry'}),null);
});

test("session creation fails closed if durable recovery storage is unavailable", async () => {
  seed();const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.startsWith('tflash:sync-uncertain:chat-create:'))throw new Error('storage blocked');return original.call(this,key,value);};
  let creates=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({sessionId:'unexpected'});}});
  try {render(app());await screen.findByText(/Recovery storage is unavailable, so a new conversation/);assert.equal(creates,0);}
  finally {proto.setItem=original;}
});

test("created Vercel ownership proof is persisted before its recovery marker is cleared", async () => {
  seed();fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST')return Response.json({sessionId:'created',ownerProof:'proof'}, {status:201});});
  render(app({},'vercel'));await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'created'));
  assert.equal(JSON.parse(window.localStorage.getItem('tflash:settings:v1:prepare-user')).chatProofs.created,'proof');
  assert.equal(Object.keys(window.localStorage).filter(k=>k.startsWith('tflash:sync-uncertain:chat-create:')).length,0);
});

test("creation hold is account-scoped and does not block resuming an existing session", async () => {
  seed();const other='tflash:sync-uncertain:chat-create:supabase:another-user:one';window.localStorage.setItem(other,'1');
  let creates=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({sessionId:'fresh'},{status:201});}});
  const mounted=render(app());await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'fresh'));assert.equal(creates,1);
  mounted.unmount();window.localStorage.setItem('tflash:sync-uncertain:chat-create:supabase:prepare-user:old','1');
  render(app({sessionId:'owned-chat'}));await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'owned-chat'));
  assert.equal(creates,1);assert.ok(window.localStorage.getItem(other));
});

test("creation review does not clear another marker created after the warning appeared", async () => {
  seed();const base='tflash:sync-uncertain:chat-create:supabase:prepare-user:';
  window.localStorage.setItem(`${base}first`,'1');let creates=0;
  fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({sessionId:'new'},{status:201});}});
  render(app());await screen.findByText(/A previous conversation may have been created/);
  window.localStorage.setItem(`${base}second`,'1');const user=userEvent.setup();
  await user.click(screen.getByRole('checkbox',{name:/I checked what I can/}));
  await user.click(screen.getByRole('button',{name:'Acknowledge and start a new conversation'}));
  assert.equal(creates,0);assert.equal(window.localStorage.getItem(`${base}first`),null);assert.equal(window.localStorage.getItem(`${base}second`),'1');
  assert.equal(screen.getByRole('button',{name:'Acknowledge and start a new conversation'}).disabled,true);
});

test("Somali uncertain creation requests explicit review and preserves the draft", async () => {
  seed({language:'so'});window.localStorage.setItem('tflash:sync-uncertain:chat-create:supabase:prepare-user:old','1');
  let creates=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({sessionId:'unexpected'});}});
  render(app());await screen.findByText(/Wada hadal hore ayaa laga yaabaa/);
  const textarea=screen.getByPlaceholderText('Wax walba weydii Tflash…');await userEvent.setup().type(textarea,'Qoraal');
  assert.equal(textarea.value,'Qoraal');assert.equal(creates,0);
  assert.equal(screen.getByRole('button',{name:'Qiro oo bilow wada hadal cusub'}).disabled,true);
});

test("changing the session prop never keeps the previously prepared session active", async () => {
  seed();let creates=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){creates++;return Response.json({sessionId:'new-session'},{status:201});}});
  const view=render(app({sessionId:'old-chat'}));await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'old-chat'));
  view.rerender(app({sessionId:'other-chat'}));await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'other-chat'));
  view.rerender(app());await waitFor(()=>assert.equal(globalThis.__prepareOptions.initialSession?.sessionId,'new-session'));
  assert.equal(creates,1);
});

test("if saving the Vercel owner proof fails, the creation marker is not cleared", async () => {
  seed();const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){
    if(key==='tflash:settings:v1:prepare-user' && String(value).includes('lost-proof'))throw new Error('quota');
    return original.call(this,key,value);
  };
  let calls=0;fakeFetch((path,options)=>{if(path==='/api/chats'&&options.method==='POST'){calls++;return Response.json({sessionId:'created',ownerProof:'lost-proof'},{status:201});}});
  try {
    render(app({},'vercel'));await screen.findByText(/A previous conversation may have been created/);
    assert.equal(calls,1);assert.equal(globalThis.__prepareOptions.initialSession,undefined);
    assert.ok(Object.keys(window.localStorage).some(k=>k.startsWith('tflash:sync-uncertain:chat-create:vercel:')));
    assert.equal(screen.getByRole('button',{name:'Send'}).disabled,true);
  } finally {proto.setItem=original;}
});

function seedApprovalFixture() {
  seed();const id='request-secret-123';
  const request={requestId:id,kind:'tool-approval',action:{callId:'shell-call'},prompt:'Run shell command?',options:[{id:'approve',label:'Approve'},{id:'cancel',label:'Cancel'}]};
  const part={type:'dynamic-tool',toolName:'bash',toolCallId:'shell-call',state:'approval-requested',input:{command:'private shell command'},toolMetadata:{eve:{inputRequest:request}}};
  globalThis.__prepareAgent.data={messages:[{id:'assistant-approval',role:'assistant',parts:[part]}],inputs:{[id]:{status:'open',request}}};
  return {id,request,part};
}

test('lost approval response persists a secret-free warning and blocks replay and plain chat',async()=>{
  const {id}=seedApprovalFixture();let calls=0;const wait=deferred();
  globalThis.__prepareAgent.respond=()=>{calls++;return wait.promise;};fakeFetch(()=>undefined);
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:'Approve once'}));await waitFor(()=>assert.equal(calls,1));
  await screen.findByText(/A response to an approval or question may have been accepted/);
  const keys=Object.keys(window.localStorage).filter(key=>key.includes(':input-response:'));assert.equal(keys.length,1);
  assert.doesNotMatch(window.localStorage.getItem(keys[0]),/request-secret|private shell|approve/);
  await user.click(screen.getByLabelText(/I inspected the conversation and external effects/));assert.equal(screen.getByRole('button',{name:'Acknowledge response review'}).disabled,true);
  await React.act(async()=>{wait.reject(new Error('lost'));try{await wait.promise;}catch{}});
  assert.equal(screen.getByRole('button',{name:'Approve once'}).disabled,true);
  const textarea=screen.getByPlaceholderText('Ask Tflash anything…');await user.type(textarea,'approve');assert.equal(screen.getByRole('button',{name:'Send'}).disabled,true);
  view.unmount();render(app({sessionId:'chat-a'}));await screen.findByText(/A response to an approval or question may have been accepted/);
  assert.equal(screen.getByRole('button',{name:'Approve once'}).disabled,true);assert.equal(calls,1);
  await user.click(screen.getByLabelText(/I inspected the conversation and external effects/));await user.click(screen.getByRole('button',{name:'Acknowledge response review'}));
  await waitFor(()=>assert.equal(Boolean(screen.queryByText(/A response to an approval or question may have been accepted/)),false));assert.equal(calls,1);
  assert.ok(id);
});

test('only matching authoritative input resolution clears the pending marker, not optimistic response',async()=>{
  const {id}=seedApprovalFixture();let calls=0;globalThis.__prepareAgent.respond=async()=>{calls++;};fakeFetch(()=>undefined);
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
  await screen.findByText(/A response to an approval or question may have been accepted/);await waitFor(()=>assert.equal(calls,1));
  globalThis.__prepareAgent.events=[{type:'client.input.responded',data:{resolutions:[{requestId:id,kind:'tool-approval',outcome:'approved'}]}},{type:'input.resolved',data:{resolutions:[{requestId:'other',kind:'tool-approval',outcome:'approved'}]}}];view.rerender(app({sessionId:'chat-a'}));
  await React.act(async()=>{});assert.ok(screen.getByText(/A response to an approval or question may have been accepted/));
  globalThis.__prepareAgent.events=[...globalThis.__prepareAgent.events,{type:'input.resolved',data:{resolutions:[{requestId:id,kind:'tool-approval',outcome:'approved'}]}}];view.rerender(app({sessionId:'chat-a'}));
  await waitFor(()=>assert.equal(Boolean(screen.queryByText(/A response to an approval or question may have been accepted/)),false));assert.equal(calls,1);
});

test('blocked recovery storage prevents an approval before invoking Eve',async()=>{
  seedApprovalFixture();let calls=0;globalThis.__prepareAgent.respond=async()=>{calls++;};fakeFetch(()=>undefined);
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.includes(':input-response:'))throw new Error('blocked');return original.call(this,key,value);};
  try {render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
    await screen.findByText(/Response recovery storage or secure hashing is unavailable/);assert.equal(calls,0);assert.equal(screen.getByRole('button',{name:'Approve once'}).disabled,true);
  } finally {proto.setItem=original;}
});

test('unmount during request-id hashing never sends an approval',async()=>{
  seedApprovalFixture();let calls=0;globalThis.__prepareAgent.respond=async()=>{calls++;};fakeFetch(()=>undefined);
  const subtle=crypto.subtle,original=subtle.digest,delayed=deferred();let hashing=false;
  subtle.digest=function(){hashing=true;return delayed.promise;};
  try {const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
    await waitFor(()=>assert.equal(hashing,true));view.unmount();await React.act(async()=>{delayed.resolve(new Uint8Array(32).buffer);await delayed.promise;});
    assert.equal(calls,0);assert.equal(Object.keys(window.localStorage).filter(k=>k.includes(':input-response:')).length,0);
  } finally {subtle.digest=original;}
});

test('stalled approval local wait expires without aborting or retrying the remote call',async()=>{
  seedApprovalFixture();let calls=0;const stalled=deferred(),realTimeout=AbortSignal.timeout;let deadline;
  globalThis.__prepareAgent.respond=()=>{calls++;return stalled.promise;};fakeFetch(()=>undefined);
  AbortSignal.timeout=(ms)=>{if(ms===30_000){deadline=new AbortController();return deadline.signal;}return realTimeout(ms);};
  try {render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
    await waitFor(()=>assert.ok(deadline));await screen.findByText(/A response to an approval or question may have been accepted/);
    await user.click(screen.getByLabelText(/I inspected the conversation and external effects/));assert.equal(screen.getByRole('button',{name:'Acknowledge response review'}).disabled,true);
    await React.act(async()=>deadline.abort());await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Acknowledge response review'}).disabled,false));
    assert.equal(screen.getByRole('button',{name:'Approve once'}).disabled,true);assert.equal(calls,1);
    await React.act(async()=>stalled.resolve());assert.equal(calls,1);
  } finally {AbortSignal.timeout=realTimeout;}
});

test('a queued chat message cannot send after approval uncertainty appears during index persistence',async()=>{
  seedApprovalFixture();let responds=0,sends=0;const index=deferred(),response=deferred();let patchStarted=false;
  globalThis.__prepareAgent.send=async()=>{sends++;};globalThis.__prepareAgent.respond=()=>{responds++;return response.promise;};
  fakeFetch((path,options)=>{if(path==='/api/chats/chat-a'&&options.method==='PATCH'){patchStarted=true;return index.promise;}});
  render(app({sessionId:'chat-a'}));const user=userEvent.setup();const field=await screen.findByPlaceholderText('Ask Tflash anything…');
  await user.type(field,'Do not send yet');await user.click(screen.getByRole('button',{name:'Send'}));await waitFor(()=>assert.equal(patchStarted,true));
  await user.click(await screen.findByRole('button',{name:'Approve once'}));await waitFor(()=>assert.equal(responds,1));
  await React.act(async()=>{index.resolve(Response.json({ok:true,title:'Test'}));await index.promise;});
  await waitFor(()=>assert.equal(field.value,'Do not send yet'));assert.equal(sends,0);
  await React.act(async()=>response.reject(new Error('lost')));
});

test('Somali input recovery warning requires explicit review',async()=>{
  seedApprovalFixture();window.localStorage.setItem('tflash:language','so');window.localStorage.setItem('tflash:settings:v1:prepare-user',JSON.stringify({language:'so'}));
  window.localStorage.setItem('tflash:sync-uncertain:input-response:supabase:prepare-user:one',JSON.stringify({sessionId:'chat-a',digest:'a'.repeat(64)}));fakeFetch(()=>undefined);
  render(app({sessionId:'chat-a'}));await screen.findByText(/Jawaab oggolaansho ama su’aal ayaa la aqbalay/);
  assert.equal(screen.getByRole('button',{name:'Qiro hubinta jawaabta'}).disabled,true);
});

test('a lost free-text question response retains the draft and blocks automatic re-answer',async()=>{
  const originalFormData = globalThis.FormData; globalThis.FormData = window.FormData;
  try {
  seed();const id='question-private';const request={requestId:id,kind:'question',action:{callId:'q-call'},prompt:'Which result should I use?',allowFreeform:true,options:[]};
  const part={type:'dynamic-tool',toolName:'ask_question',toolCallId:'q-call',state:'input-available',input:{}};
  globalThis.__prepareAgent.data={messages:[{id:'q-message',role:'assistant',parts:[part]}],inputs:{[id]:{status:'open',request}}};
  let calls=0;globalThis.__prepareAgent.respond=async()=>{calls++;throw new Error('uncertain');};fakeFetch(()=>undefined);
  render(app({sessionId:'chat-a'}));const user=userEvent.setup();const answer=await screen.findByRole('textbox',{name:'Answer'});
  await user.type(answer,'Private response');await user.click(screen.getByRole('button',{name:'Answer'}));
  await screen.findByText(/A response to an approval or question may have been accepted/);await waitFor(()=>assert.equal(calls,1));
  assert.equal(screen.getByRole('textbox',{name:'Answer'}).value,'Private response');assert.equal(screen.queryByRole('button',{name:'Answer'}),null);
  const key=Object.keys(window.localStorage).find(k=>k.includes(':input-response:'));assert.doesNotMatch(window.localStorage.getItem(key),/Private response|question-private/);
  } finally {globalThis.FormData = originalFormData;}
});

test('stop remains available while an approval response is unconfirmed',async()=>{
  seedApprovalFixture();globalThis.__prepareAgent.status='streaming';let stops=0;const pending=deferred();
  globalThis.__prepareAgent.respond=()=>pending.promise;globalThis.__prepareAgent.cancel=async()=>{stops++;};fakeFetch(()=>undefined);
  render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
  await screen.findByText(/A response to an approval or question may have been accepted/);await user.click(screen.getByRole('button',{name:'Stop'}));
  await waitFor(()=>assert.equal(stops,1));await React.act(async()=>pending.reject(new Error('lost')));
});

test('unmount after responding retains the marker and ignores a late promise',async()=>{
  seedApprovalFixture();let calls=0;const pending=deferred();globalThis.__prepareAgent.respond=()=>{calls++;return pending.promise;};fakeFetch(()=>undefined);
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));await waitFor(()=>assert.equal(calls,1));
  view.unmount();await React.act(async()=>{pending.resolve();await pending.promise;});render(app({sessionId:'chat-a'}));
  await screen.findByText(/A response to an approval or question may have been accepted/);assert.equal(calls,1);assert.equal(screen.getByRole('button',{name:'Approve once'}).disabled,true);
});

test('plain chat while an approval is open is protected as a possible response',async()=>{
  const {id}=seedApprovalFixture();let calls=0;globalThis.__prepareAgent.send=async()=>{calls++;throw new Error('lost');};fakeFetch(()=>undefined);
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();const field=await screen.findByPlaceholderText('Ask Tflash anything…');
  await user.type(field,'approve');await user.click(screen.getByRole('button',{name:'Send'}));await waitFor(()=>assert.equal(calls,1));
  await screen.findByText(/A response to an approval or question may have been accepted/);assert.equal(field.value,'approve');
  const keys=Object.keys(window.localStorage).filter(k=>k.includes(':input-response:'));assert.equal(keys.length,1);assert.doesNotMatch(window.localStorage.getItem(keys[0]),/approve|request-secret/);
  view.unmount();render(app({sessionId:'chat-a'}));await screen.findByText(/A response to an approval or question may have been accepted/);assert.equal(calls,1);assert.ok(id);
});

test('plain chat cannot answer an open approval if its recovery marker cannot be saved',async()=>{
  seedApprovalFixture();let calls=0;globalThis.__prepareAgent.send=async()=>{calls++;};fakeFetch(()=>undefined);
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.includes(':input-response:'))throw new Error('blocked');return original.call(this,key,value);};
  try {render(app({sessionId:'chat-a'}));const user=userEvent.setup();const field=await screen.findByPlaceholderText('Ask Tflash anything…');
    await user.type(field,'approve');await user.click(screen.getByRole('button',{name:'Send'}));await screen.findByText(/Response recovery storage or secure hashing is unavailable/);
    assert.equal(calls,0);assert.equal(field.value,'approve');assert.equal(screen.getByRole('button',{name:'Send'}).disabled,true);
  } finally {proto.setItem=original;}
});

test('plain chat marker needs human review even when the locally observed prompt resolves',async()=>{
  const {id}=seedApprovalFixture();let calls=0;globalThis.__prepareAgent.send=async()=>{calls++;};fakeFetch(()=>undefined);
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();const field=await screen.findByPlaceholderText('Ask Tflash anything…');
  await user.type(field,'approve');await user.click(screen.getByRole('button',{name:'Send'}));await waitFor(()=>assert.equal(calls,1));
  await screen.findByText(/A response to an approval or question may have been accepted/);
  globalThis.__prepareAgent.events=[{type:'input.resolved',data:{resolutions:[{requestId:id,kind:'tool-approval',outcome:'approved'}]}}];view.rerender(app({sessionId:'chat-a'}));
  await React.act(async()=>{});assert.ok(screen.getByText(/A response to an approval or question may have been accepted/));assert.equal(calls,1);
});

test('a question draft survives another tab introducing an uncertainty warning',async()=>{
  const originalFormData=globalThis.FormData;globalThis.FormData=window.FormData;
  try {
    seed();const id='question-draft';const request={requestId:id,kind:'question',action:{callId:'q-call'},prompt:'Which result?',allowFreeform:true,options:[]};
    globalThis.__prepareAgent.data={messages:[{id:'q',role:'assistant',parts:[{type:'dynamic-tool',toolName:'ask_question',toolCallId:'q-call',state:'input-available',input:{}}]}],inputs:{[id]:{status:'open',request}}};fakeFetch(()=>undefined);
    render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.type(await screen.findByRole('textbox',{name:'Answer'}),'Keep this draft');
    const key='tflash:sync-uncertain:input-response:supabase:prepare-user:tab';
    await React.act(async()=>{window.localStorage.setItem(key,JSON.stringify({sessionId:'chat-a',digest:'a'.repeat(64)}));window.dispatchEvent(new window.StorageEvent('storage',{key}));});
    await screen.findByText(/A response to an approval or question may have been accepted/);assert.equal(screen.getByRole('textbox',{name:'Answer'}).value,'Keep this draft');assert.equal(screen.getByRole('textbox',{name:'Answer'}).disabled,true);
  } finally {globalThis.FormData=originalFormData;}
});

test('switching accounts during response preparation never dispatches the old decision',async()=>{
  seedApprovalFixture();let calls=0;globalThis.__prepareAgent.respond=async()=>{calls++;};fakeFetch(()=>undefined);
  const subtle=crypto.subtle,original=subtle.digest,delayed=deferred();let hashing=false;
  subtle.digest=function(){hashing=true;return delayed.promise;};
  const tree=id=>h(AppSettingsProvider,{userId:id,accountKind:'supabase'},h(TooltipProvider,null,h(AgentChat,{account:{...account,id},sessionId:'chat-a',sessionless:true})));
  try {const view=render(tree(account.id));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
    await waitFor(()=>assert.equal(hashing,true));view.rerender(tree('another-account'));await React.act(async()=>{delayed.resolve(new Uint8Array(32).buffer);await delayed.promise;});
    assert.equal(calls,0);assert.equal(Object.keys(window.localStorage).filter(k=>k.includes(':input-response:')).length,0);
  } finally {subtle.digest=original;}
});

test('failed marker deletion does not silently dismiss a settled approval warning',async()=>{
  const {id}=seedApprovalFixture();globalThis.__prepareAgent.respond=async()=>{};fakeFetch(()=>undefined);
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.removeItem;
  const view=render(app({sessionId:'chat-a'}));const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Approve once'}));
  await screen.findByText(/A response to an approval or question may have been accepted/);
  proto.removeItem=function(key){if(key.includes(':input-response:'))throw new Error('blocked');return original.call(this,key);};
  try {
    globalThis.__prepareAgent.events=[{type:'input.resolved',data:{resolutions:[{requestId:id,kind:'tool-approval',outcome:'approved'}]}}];view.rerender(app({sessionId:'chat-a'}));
    await screen.findByText(/Response recovery storage or secure hashing is unavailable/);assert.ok(screen.getByText(/A response to an approval or question may have been accepted/));
    await user.click(screen.getByLabelText(/I inspected the conversation and external effects/));await user.click(screen.getByRole('button',{name:'Acknowledge response review'}));
    assert.ok(screen.getByText(/Could not save the review/));
  } finally {proto.removeItem=original;}
});

test('connected Stop uses the exact observed turn even after streaming, and only its cancellation event clears the marker', async () => {
  const sends = seed({ agentStatus: 'streaming' }); let hookCancels = 0, body, calls = 0;
  globalThis.__prepareAgent.cancel = async () => { hookCancels++; };
  globalThis.__prepareAgent.data.activeTurnId = 'turn-old';
  globalThis.__prepareAgent.data.turns = { 'turn-old': { status: 'active' } };
  fakeFetch((path, options) => { if (path.endsWith('/eve/v1/session/owned-chat/cancel')) { calls++; body = JSON.parse(options.body); assert.ok(options.signal); return Response.json({ ok: true, status: 'accepted', sessionId: 'owned-chat' }, { status: 202 }); } });
  const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Stop' }));
  await waitFor(() => assert.equal(calls, 1)); assert.equal(body.turnId, 'turn-old'); assert.equal(hookCancels, 0);
  await screen.findByText(/A stop request may have been accepted/);
  const keys = Object.keys(window.localStorage).filter(k => k.includes(':stop-request:'));
  assert.equal(keys.length, 1); assert.deepEqual(JSON.parse(window.localStorage.getItem(keys[0])), { sessionId: 'owned-chat', turnId: 'turn-old' });
  globalThis.__prepareAgent.status = 'ready';
  globalThis.__prepareAgent.events = [{ type: 'turn.cancelled', data: { turnId: 'other-turn' } }, { type: 'turn.completed', data: { turnId: 'turn-old' } }];
  view.rerender(app({ sessionId: 'owned-chat' }));
  assert.ok(screen.getByText(/A stop request may have been accepted/));
  assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
  globalThis.__prepareAgent.events = [{ type: 'turn.cancelled', data: { turnId: 'turn-old' } }];
  view.rerender(app({ sessionId: 'owned-chat' }));
  assert.ok(screen.getByText(/A stop request may have been accepted/), 'a cancellation alone is not a session.waiting boundary');
  globalThis.__prepareAgent.events = [...globalThis.__prepareAgent.events, { type: 'session.waiting', data: {} }];
  view.rerender(app({ sessionId: 'owned-chat' }));
  await waitFor(() => assert.equal(Boolean(screen.queryByText(/A stop request may have been accepted/)), false));
  assert.equal(window.localStorage.getItem(keys[0]), null); assert.equal(sends.length, 0);
});

test('timed-out stop remains uncertain across remount and a late result never replays work', async () => {
  const sends = seed({ agentStatus: 'streaming' }); const oldTimeout = AbortSignal.timeout; let deadline, stops = 0;
  const pending = deferred(); globalThis.__prepareAgent.cancel = () => { stops++; return pending.promise; };
  AbortSignal.timeout = (ms) => { if (ms === 15_000) { deadline = new AbortController(); return deadline.signal; } return oldTimeout(ms); };
  try {
    fakeFetch(() => undefined); const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('Ask Tflash anything…'); await user.type(field, 'Preserve this draft');
    await user.click(screen.getByRole('button', { name: 'Stop' })); await waitFor(() => assert.equal(stops, 1));
    assert.equal(screen.getByRole('button', { name: 'Acknowledge stop review' }).disabled, true);
    await React.act(async () => deadline.abort(new Error('local stop wait expired')));
    await screen.findByText('local stop wait expired');
    globalThis.__prepareAgent.status = 'ready'; view.rerender(app({ sessionId: 'owned-chat' }));
    assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true); assert.equal(field.value, 'Preserve this draft');
    view.unmount(); render(app({ sessionId: 'owned-chat' }));
    await screen.findByText(/A stop request may have been accepted/);
    await React.act(async () => { pending.resolve({ status: 'no_active_turn' }); await pending.promise; });
    assert.ok(screen.getByText(/A stop request may have been accepted/)); assert.equal(stops, 1); assert.equal(sends.length, 0);
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the conversation and external effects and understand the stop request/ }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge stop review' }));
    await waitFor(() => assert.equal(Boolean(screen.queryByText(/A stop request may have been accepted/)), false));
    assert.equal(stops, 1); assert.equal(sends.length, 0);
  } finally { AbortSignal.timeout = oldTimeout; }
});

test('Stop remains protective when marker writes fail, with an in-memory warning', async () => {
  const sends = seed({ agentStatus: 'streaming' }); let calls = 0;
  globalThis.__prepareAgent.cancel = async () => { calls++; return { status: 'accepted', sessionId: 'owned-chat' }; };
  fakeFetch(() => undefined); const proto = Object.getPrototypeOf(window.localStorage), original = proto.setItem;
  proto.setItem = function(key, value) { if (key.includes(':stop-request:')) throw new Error('blocked'); return original.call(this, key, value); };
  try {
    const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stop' })); await waitFor(() => assert.equal(calls, 1));
    await screen.findByText(/Stop recovery could not be saved/);
    globalThis.__prepareAgent.status = 'ready'; view.rerender(app({ sessionId: 'owned-chat' }));
    assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true); assert.equal(sends.length, 0);
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the conversation and external effects and understand the stop request/ }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge stop review' }));
    await waitFor(() => assert.equal(Boolean(screen.queryByText(/Stop recovery could not be saved/)), false));
    assert.equal(calls, 1); assert.equal(sends.length, 0);
  } finally { proto.setItem = original; }
});

test('other-tab stop warning blocks forced sends; unrelated account and session remain isolated', async () => {
  const sends = seed(); fakeFetch(() => undefined); const view = render(app({ sessionId: 'owned-chat' }));
  const field = await screen.findByPlaceholderText('Ask Tflash anything…'); const user = userEvent.setup(); await user.type(field, 'Keep draft');
  const prefix = 'tflash:sync-uncertain:stop-request:supabase:';
  await React.act(async () => { window.localStorage.setItem(prefix + 'other:one', JSON.stringify({ sessionId: 'owned-chat', turnId: null })); window.localStorage.setItem(prefix + 'prepare-user:two', JSON.stringify({ sessionId: 'another-chat', turnId: null })); window.dispatchEvent(new window.StorageEvent('storage')); });
  assert.equal(Boolean(screen.queryByText(/A stop request may have been accepted/)), false);
  const key = prefix + 'prepare-user:three';
  await React.act(async () => { window.localStorage.setItem(key, JSON.stringify({ sessionId: 'owned-chat', turnId: null })); window.dispatchEvent(new window.StorageEvent('storage', { key })); });
  await screen.findByText(/A stop request may have been accepted/); fireEvent.submit(field.closest('form'));
  await React.act(async () => {}); assert.equal(sends.length, 0); assert.equal(field.value, 'Keep draft');
  assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true); view.unmount();
});

test('stalled reconnect releases its local wait without sending or cancelling the server turn', async () => {
  const sends = seed({ agentStatus: 'error' }); const pending = deferred(); let resumes = 0, cancels = 0, deadline;
  globalThis.__prepareAgent.data.activeTurnId = 'turn-old'; globalThis.__prepareAgent.data.turns = { 'turn-old': { status: 'active' } };
  globalThis.__prepareAgent.resume = () => { resumes++; return pending.promise; }; globalThis.__prepareAgent.cancel = () => { cancels++; };
  const oldTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => { if (ms === 15_000) { deadline = new AbortController(); return deadline.signal; } return oldTimeout(ms); };
  try { fakeFetch(() => undefined); render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reconnect' })); await waitFor(() => assert.equal(resumes, 1));
    assert.equal(screen.getByRole('button', { name: 'Reconnect' }).disabled, true);
    await React.act(async () => deadline.abort(new Error('local reconnect wait expired')));
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Reconnect' }).disabled, false));
    assert.equal(cancels, 0); assert.equal(sends.length, 0);
    await React.act(async () => { pending.resolve(); await pending.promise; });
    assert.equal(resumes, 1); assert.equal(sends.length, 0);
  } finally { AbortSignal.timeout = oldTimeout; }
});

test('Somali Stop uncertainty requires an explicit review', async () => {
  seed({ language: 'so', agentStatus: 'streaming' }); let calls = 0;
  globalThis.__prepareAgent.cancel = async () => { calls++; return { status: 'no_active_turn' }; }; fakeFetch(() => undefined);
  render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Jooji' })); await waitFor(() => assert.equal(calls, 1));
  await screen.findByText(/Codsiga joojinta waa la aqbalay ama weli wuu iman karaa/);
  assert.equal(screen.getByRole('button', { name: 'Qiro hubinta joojinta' }).disabled, true);
});

test('a stop that settles after unmount does not reconnect the old conversation', async () => {
  seed({ agentStatus: 'error' }); let resumes = 0;
  globalThis.__prepareAgent.data.activeTurnId = 'turn-old'; globalThis.__prepareAgent.data.turns = { 'turn-old': { status: 'active' } };
  globalThis.__prepareAgent.resume = async () => { resumes++; }; const pending = deferred();
  fakeFetch(path => path.endsWith('/eve/v1/session/owned-chat/cancel') ? pending.promise : undefined);
  const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Request stop for this turn' }));
  assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':stop-request:')).length, 1);
  view.unmount(); await React.act(async () => { pending.resolve(Response.json({ ok: true, status: 'accepted', sessionId: 'owned-chat' }, { status: 202 })); await pending.promise; });
  assert.equal(resumes, 0); assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':stop-request:')).length, 1);
});

test('a failed stop marker deletion keeps the warning and follow-ups blocked', async () => {
  seed({ agentStatus: 'streaming' }); globalThis.__prepareAgent.cancel = async () => ({ status: 'no_active_turn' }); fakeFetch(() => undefined);
  const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Stop' }));
  await screen.findByText(/A stop request may have been accepted/); globalThis.__prepareAgent.status = 'ready'; view.rerender(app({ sessionId: 'owned-chat' }));
  const proto = Object.getPrototypeOf(window.localStorage), original = proto.removeItem;
  proto.removeItem = function(key) { if (key.includes(':stop-request:')) throw new Error('blocked'); return original.call(this, key); };
  try {
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the conversation and external effects and understand the stop request/ }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge stop review' }));
    assert.ok(screen.getByText(/A stop request may have been accepted/)); assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
    assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':stop-request:')).length, 1);
  } finally { proto.removeItem = original; }
});

test('scoped stop timeout aborts only the transport wait and retains the exact-turn marker', async () => {
  const sends = seed({ agentStatus: 'streaming' }); const pending = deferred(); let signal, deadline, calls = 0;
  globalThis.__prepareAgent.data.activeTurnId = 'turn-new'; globalThis.__prepareAgent.data.turns = { 'turn-new': { status: 'active' } };
  globalThis.__prepareAgent.events = [{ type: 'turn.started', data: { turnId: 'turn-older', sequence: 1 } }];
  fakeFetch((path, options) => { if (path.endsWith('/eve/v1/session/owned-chat/cancel')) { calls++; signal = options.signal; assert.equal(JSON.parse(options.body).turnId, 'turn-new'); return pending.promise; } });
  const original = AbortSignal.timeout; AbortSignal.timeout = ms => { if (ms === 15_000) { deadline = new AbortController(); return deadline.signal; } return original(ms); };
  try {
    const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stop' })); await waitFor(() => assert.equal(calls, 1));
    await React.act(async () => deadline.abort(new Error('deadline'))); assert.equal(signal.aborted, true);
    await screen.findByText(/A stop request may have been accepted/);
    const keys = Object.keys(window.localStorage).filter(k => k.includes(':stop-request:'));
    assert.equal(JSON.parse(window.localStorage.getItem(keys[0])).turnId, 'turn-new');
    globalThis.__prepareAgent.status = 'ready'; globalThis.__prepareAgent.events = [{ type: 'turn.cancelled', data: { turnId: 'turn-older' } }]; view.rerender(app({ sessionId: 'owned-chat' }));
    await React.act(async () => { pending.resolve(Response.json({ ok: true, status: 'accepted', sessionId: 'owned-chat' }, { status: 202 })); await pending.promise; });
    assert.ok(screen.getByText(/A stop request may have been accepted/)); assert.equal(calls, 1); assert.equal(sends.length, 0);
  } finally { AbortSignal.timeout = original; }
});

test('a stop warning blocks approval responses as well as plain messages', async () => {
  seedApprovalFixture(); let calls = 0; globalThis.__prepareAgent.respond = async () => { calls++; }; fakeFetch(() => undefined);
  const key = 'tflash:sync-uncertain:stop-request:supabase:prepare-user:other-tab';
  window.localStorage.setItem(key, JSON.stringify({ sessionId: 'chat-a', turnId: null }));
  render(app({ sessionId: 'chat-a' })); await screen.findByText(/A stop request may have been accepted/);
  const approve = await screen.findByRole('button', { name: 'Approve once' }); assert.equal(approve.disabled, true);
  fireEvent.click(approve); assert.equal(calls, 0); assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
});

test('shared dispatch marker precedes send and preserves same-tab steering until clean settlement', async () => {
  seed(); fakeFetch(() => undefined); const pending = deferred(); const sends = [];
  globalThis.__prepareAgent.send = async (message, options) => {
    const markers = Object.keys(window.localStorage).filter(k => k.includes(':turn-dispatch:'));
    assert.ok(markers.length >= 1); assert.doesNotMatch(window.localStorage.getItem(markers.at(-1)), /private message|steer text/);
    sends.push({ message, options }); await pending.promise;
  };
  const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  const field = await screen.findByPlaceholderText('Ask Tflash anything…'); await user.type(field, 'private message'); await user.keyboard('{Enter}');
  await waitFor(() => assert.equal(sends.length, 1)); assert.equal(Boolean(screen.queryByText(/A message may be running in another tab/)), false);
  globalThis.__prepareAgent.status = 'streaming'; view.rerender(app({ sessionId: 'owned-chat' }));
  await user.type(field, 'steer text'); await user.keyboard('{Enter}'); await waitFor(() => assert.equal(sends.length, 2));
  assert.equal(sends[1].options.turnPolicy, 'steer'); assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':turn-dispatch:')).length, 2);
  await React.act(async () => { pending.resolve(); await pending.promise; });
  await waitFor(() => assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':turn-dispatch:')).length, 0));
  assert.equal(sends.length, 2);
});

test('an in-flight dispatch survives unmount and a late success does not erase shared or tab recovery', async () => {
  seed(); fakeFetch(() => undefined); const pending = deferred(); let sends = 0;
  globalThis.__prepareAgent.send = () => { sends++; return pending.promise; };
  const view = render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  await user.type(await screen.findByPlaceholderText('Ask Tflash anything…'), 'possible side effect'); await user.keyboard('{Enter}'); await waitFor(() => assert.equal(sends, 1));
  const key = Object.keys(window.localStorage).find(k => k.includes(':turn-dispatch:')); assert.ok(key);
  view.unmount(); await React.act(async () => { pending.resolve(); await pending.promise; });
  assert.ok(window.localStorage.getItem(key)); assert.ok(window.sessionStorage.getItem('tflash:dispatch-review:v1:supabase:prepare-user:owned-chat'));
  // A different tab has a separate sessionStorage but shares localStorage.
  window.sessionStorage.clear(); render(app({ sessionId: 'owned-chat' }));
  await screen.findByText(/A message may be running in another tab/); assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
  assert.equal(sends, 1);
});

test('another tab warning blocks a queued message after history persistence without replay', async () => {
  const sends = seed(); const pending = deferred(); let historyStarted = false;
  fakeFetch((path, options) => { if (path === '/api/chats/owned-chat' && options.method === 'PATCH') { historyStarted = true; return pending.promise; } });
  render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); const field = await screen.findByPlaceholderText('Ask Tflash anything…');
  await user.type(field, 'Preserve my draft'); await user.keyboard('{Enter}'); await waitFor(() => assert.equal(historyStarted, true));
  const key = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:other-tab';
  await React.act(async () => { window.localStorage.setItem(key, JSON.stringify({ sessionId: 'owned-chat' })); window.dispatchEvent(new window.StorageEvent('storage', { key })); });
  await React.act(async () => { pending.resolve(Response.json({ ok: true, title: 'test' })); await pending.promise; });
  await screen.findByText(/A message may be running in another tab/); await waitFor(() => assert.equal(field.value, 'Preserve my draft'));
  assert.equal(sends.length, 0); assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
});

test('shared dispatch warning blocks approval responses but not protective Stop', async () => {
  seedApprovalFixture(); globalThis.__prepareAgent.status = 'streaming'; let responses = 0, stops = 0;
  globalThis.__prepareAgent.respond = async () => { responses++; }; globalThis.__prepareAgent.cancel = async () => { stops++; }; fakeFetch(() => undefined);
  const key = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:other'; window.localStorage.setItem(key, JSON.stringify({ sessionId: 'chat-a' }));
  render(app({ sessionId: 'chat-a' })); const user = userEvent.setup(); await screen.findByText(/A message may be running in another tab/);
  const approve = await screen.findByRole('button', { name: 'Approve once' }); assert.equal(approve.disabled, true); fireEvent.click(approve); assert.equal(responses, 0);
  await user.click(screen.getByRole('button', { name: 'Stop' })); await waitFor(() => assert.equal(stops, 1)); assert.equal(responses, 0);
});

test('shared dispatch reviews are individual and cannot clear another new marker', async () => {
  const sends = seed(); fakeFetch(() => undefined); const prefix = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:';
  const first = prefix + 'first', second = prefix + 'second'; window.localStorage.setItem(first, JSON.stringify({ sessionId: 'owned-chat' }));
  render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); await screen.findByText(/A message may be running in another tab/);
  await user.click(screen.getByRole('checkbox', { name: /I checked the conversation and external effects and understand the earlier request/ }));
  // Another tab writes after the review checkbox was checked, before the click.
  window.localStorage.setItem(second, JSON.stringify({ sessionId: 'owned-chat' }));
  await user.click(screen.getByRole('button', { name: 'Acknowledge this shared dispatch' }));
  assert.equal(window.localStorage.getItem(first), null); assert.ok(window.localStorage.getItem(second));
  assert.ok(screen.getByText(/A message may be running in another tab/)); assert.equal(sends.length, 0);
});

test('shared marker creation failure is visible while preserving same-tab fallback behavior', async () => {
  const sends = seed(); fakeFetch(() => undefined); const proto = Object.getPrototypeOf(window.localStorage), original = proto.setItem;
  proto.setItem = function(key, value) { if (key.includes(':turn-dispatch:')) throw new Error('blocked'); return original.call(this, key, value); };
  try { render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); const field = await screen.findByPlaceholderText('Ask Tflash anything…');
    await user.type(field, 'one message'); await user.keyboard('{Enter}'); await waitFor(() => assert.equal(sends.length, 1));
    await screen.findByText(/The cross-tab dispatch warning could not be saved/);
    assert.equal(Object.keys(window.localStorage).filter(k => k.includes(':turn-dispatch:')).length, 0); assert.equal(sends.length, 1);
  } finally { proto.setItem = original; }
});

test('shared marker deletion failure leaves a warning rather than silently clearing it', async () => {
  const sends = seed(); fakeFetch(() => undefined); const proto = Object.getPrototypeOf(window.localStorage), original = proto.removeItem;
  proto.removeItem = function(key) { if (key.includes(':turn-dispatch:')) throw new Error('blocked'); return original.call(this, key); };
  try { render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); const field = await screen.findByPlaceholderText('Ask Tflash anything…');
    await user.type(field, 'one message'); await user.keyboard('{Enter}'); await waitFor(() => assert.equal(sends.length, 1));
    await screen.findByText(/A message may be running in another tab/); assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
    await user.click(screen.getByRole('checkbox', { name: /I checked the conversation and external effects and understand the earlier request/ }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge this shared dispatch' }));
    assert.ok(screen.getByText(/A message may be running in another tab/)); assert.equal(sends.length, 1);
  } finally { proto.removeItem = original; }
});

test('shared dispatch recovery is translated into Somali', async () => {
  seed({ language: 'so' }); fakeFetch(() => undefined);
  window.localStorage.setItem('tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:so', JSON.stringify({ sessionId: 'owned-chat' }));
  render(app({ sessionId: 'owned-chat' })); await screen.findByText(/Fariin ayaa tab kale ku socon karta/);
  assert.equal(screen.getByRole('button', { name: 'Qiro diristan la wadaago' }).disabled, true);
});

test('review does not clear a shared marker whose content changed after the user checked it', async () => {
  seed(); fakeFetch(() => undefined); const key = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:changed';
  window.localStorage.setItem(key, JSON.stringify({ sessionId: 'owned-chat' })); render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup();
  await screen.findByText(/A message may be running in another tab/);
  await user.click(screen.getByRole('checkbox', { name: /I checked the conversation and external effects and understand the earlier request/ }));
  window.localStorage.setItem(key, 'corrupt replacement');
  await user.click(screen.getByRole('button', { name: 'Acknowledge this shared dispatch' }));
  assert.equal(window.localStorage.getItem(key), 'corrupt replacement');
  assert.equal(screen.getByRole('button', { name: 'Acknowledge this shared dispatch' }).disabled, true);
  assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
});

test('a competing shared marker appearing during reservation prevents dispatch', async () => {
  const sends = seed(); fakeFetch(() => undefined); const proto = Object.getPrototypeOf(window.localStorage), original = proto.setItem;
  const foreign = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:concurrent'; let inserted = false;
  proto.setItem = function(key, value) { const result = original.call(this, key, value); if (!inserted && key.includes(':turn-dispatch:')) { inserted = true; original.call(this, foreign, JSON.stringify({ sessionId: 'owned-chat' })); } return result; };
  try { render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); const field = await screen.findByPlaceholderText('Ask Tflash anything…');
    await user.type(field, 'Do not send'); await user.keyboard('{Enter}'); await screen.findByText(/A message may be running in another tab/);
    await waitFor(() => assert.equal(field.value, 'Do not send')); assert.equal(sends.length, 0);
    const keys = Object.keys(window.localStorage).filter(k => k.includes(':turn-dispatch:')); assert.deepEqual(keys, [foreign]);
  } finally { proto.setItem = original; }
});

test('unreadable shared dispatch recovery blocks sends but still permits protective Stop', async () => {
  seed({ agentStatus: 'streaming' }); let stops = 0; globalThis.__prepareAgent.cancel = async () => { stops++; }; fakeFetch(() => undefined);
  const key = 'tflash:sync-uncertain:turn-dispatch:supabase:prepare-user:unreadable'; window.localStorage.setItem(key, JSON.stringify({ sessionId: 'owned-chat' }));
  const proto = Object.getPrototypeOf(window.localStorage), original = proto.getItem;
  proto.getItem = function(k) { if (k === key) throw new Error('unreadable'); return original.call(this, k); };
  try { render(app({ sessionId: 'owned-chat' })); const user = userEvent.setup(); await screen.findByText(/Cross-tab dispatch recovery cannot be read/);
    const field = await screen.findByPlaceholderText('Ask Tflash anything…'); await user.type(field, 'keep me');
    assert.equal(screen.getByRole('button', { name: 'Send' }).disabled, true);
    await user.click(screen.getByRole('button', { name: 'Stop' })); await waitFor(() => assert.equal(stops, 1));
  } finally { proto.getItem = original; }
});
