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
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect", "History"]) {
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
const { render, screen, waitFor, cleanup, fireEvent } = await import("@testing-library/react");
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

  await React.act(async () => first.resolve(Response.json({ code: "CHAT_STORAGE_SETUP_REQUIRED", error: "private diagnostic" }, { status: 503 })));
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
      if (creates === 1) return Response.json({ code: "CHAT_STORAGE_UNAVAILABLE" }, { status: 503 });
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
  assert.match((await screen.findByRole("alert")).textContent, /Could not start a conversation/);
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
  assert.match((await screen.findByRole("alert")).textContent, /Could not start a conversation/);
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true);
  assert.equal(sends.length, 0);
  await user.click(screen.getByRole("button", { name: "Retry" }));
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
