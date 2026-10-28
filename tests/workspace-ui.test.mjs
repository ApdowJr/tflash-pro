import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// Real React components and Radix controls, with a local DOM and mocked APIs.
// Nothing in this suite contacts a provider or an authentication service.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/",
  pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.PointerEvent = dom.window.MouseEvent;
globalThis.PointerEvent = dom.window.MouseEvent;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
dom.window.HTMLElement.prototype.setPointerCapture = () => {};
dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
register();

const React = await import("react");
const { render, screen, waitFor, cleanup, fireEvent, within } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { AppSettingsProvider, useAppSettings } = await import("../components/settings/app-settings.tsx");
const { Sidebar } = await import("../components/workspace/sidebar.tsx");
const { SettingsDialog } = await import("../components/settings/settings-dialog.tsx");
const { ModelBrowser } = await import("../components/settings/model-browser.tsx");
const { ModelPicker } = await import("../components/settings/model-picker.tsx");
const { ChatComposer } = await import("../components/chat/chat-composer.tsx");
const { AuthScreen } = await import("../components/app/auth-screen.tsx");
const { browserSupabase } = await import("../lib/supabase/browser.ts");
const { PromptInputProvider } = await import("../components/ai-elements/prompt-input.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");

const realFetch = globalThis.fetch;
const h = React.createElement;
const userId = "ui-test";
const storageKey = `tflash:settings:v1:${userId}`;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.localStorage.clear();
});

function seed({ language = "en", chats = [], chatProofs = {}, connections = {} } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem("tflash:language", language);
  window.localStorage.setItem(storageKey, JSON.stringify({ language, chats, chatProofs, connections }));
}

function app(child, accountKind = "vercel") {
  return h(AppSettingsProvider, { userId, accountKind }, child);
}

function fakeFetch(handler = () => undefined) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    const response = await handler(path, options);
    if (response) return response;
    if (path === "/api/providers") {
      return Response.json({ providers: [{ id: "gateway", envConfigured: true }] });
    }
    if (path.startsWith("/api/providers/models?")) {
      return Response.json({ models: [{ id: "example/model", name: "Example model" }], source: "static" });
    }
    if (path.startsWith("/api/chats/")) return Response.json({ ok: true });
    if (path === "/api/chats") return Response.json({ chats: [], storage: "account" });
    throw new Error(`Unexpected request in UI test: ${path}`);
  };
  return calls;
}

test("history actions rename, confirm removal, report failure, and persist before navigation", async () => {
  seed({ chats: [{ id: "chat-a", title: "Original title", updatedAt: Date.now() }], chatProofs: { "chat-a": "owner-proof" } });
  let deleteFails = true;
  const calls = fakeFetch((path, options) => {
    if (path === "/api/chats/chat-a" && options.method === "DELETE" && deleteFails) {
      return Response.json({ error: "offline" }, { status: 503 });
    }
  });
  let navigated = false;
  const onNewChat = () => {
    const saved = JSON.parse(window.localStorage.getItem(storageKey));
    assert.deepEqual(saved.chats, []);
    assert.equal(saved.chatProofs["chat-a"], undefined);
    navigated = true;
  };
  render(app(h(Sidebar, { open: true, activeChatId: "chat-a", onClose() {}, onNewChat, onOpenSettings() {} })));
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Original title" });

  await user.click(screen.getByRole("button", { name: "Chat actions: Original title" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename chat" }));
  const renameDialog = await screen.findByRole("dialog", { name: "Rename chat" });
  const name = within(renameDialog).getByLabelText("Chat name");
  await user.clear(name);
  await user.type(name, "Project notes");
  await user.click(within(renameDialog).getByRole("button", { name: "Save" }));
  await screen.findByRole("link", { name: "Project notes" });
  const renameRequest = calls.find((call) => call.options.method === "PATCH");
  assert.equal(new Headers(renameRequest.options.headers).get("x-tflash-owner-proof"), "owner-proof");
  assert.equal(JSON.parse(renameRequest.options.body).title, "Project notes");
  assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).chats[0].title, "Project notes");

  const search = screen.getByRole("searchbox", { name: "Search chats…" });
  await user.type(search, "not-found");
  assert.ok(screen.getByText("No chats match your search."));
  await user.clear(search);

  await user.click(screen.getByRole("button", { name: "Chat actions: Project notes" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove chat" }));
  let removeDialog = await screen.findByRole("dialog", { name: "Remove chat" });
  assert.match(removeDialog.textContent, /Stored events may remain/);
  await user.click(within(removeDialog).getByRole("button", { name: "Cancel" }));
  assert.equal(calls.filter((call) => call.options.method === "DELETE").length, 0);

  await user.click(screen.getByRole("button", { name: "Chat actions: Project notes" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove chat" }));
  removeDialog = await screen.findByRole("dialog", { name: "Remove chat" });
  await user.click(within(removeDialog).getByRole("button", { name: "Remove" }));
  assert.ok(await within(removeDialog).findByRole("alert"));
  assert.ok(screen.getByRole("link", { name: "Project notes", hidden: true }));
  assert.equal(navigated, false);

  deleteFails = false;
  await user.click(within(removeDialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => assert.equal(navigated, true));
  assert.equal(calls.filter((call) => call.options.method === "DELETE").length, 2);
});

test("Somali history actions and empty search are translated", async () => {
  seed({ language: "so", chats: [{ id: "so-chat", title: "Qoraal", updatedAt: Date.now() }], chatProofs: { "so-chat": "proof" } });
  fakeFetch();
  render(app(h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} })));
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Qoraal" });
  await user.click(screen.getByRole("button", { name: "Ficillada wada hadalka: Qoraal" }));
  await user.click(screen.getByRole("menuitem", { name: "Magac u beddel" }));
  const dialog = await screen.findByRole("dialog", { name: "Magac u beddel" });
  assert.ok(within(dialog).getByLabelText("Magaca wada hadalka"));
  assert.ok(within(dialog).getByRole("button", { name: "Kaydi" }));
  await user.click(within(dialog).getByRole("button", { name: "Jooji" }));
  await user.type(screen.getByRole("searchbox", { name: "Raadi wada hadallo…" }), "ma-jirto");
  assert.ok(screen.getByText("Ma jiro wada hadal ku habboon raadinta."));
});

test("provider settings are searchable, clear unfinished keys, and connect OpenRouter", async () => {
  seed();
  const calls = fakeFetch((path, options) => {
    if (path === "/api/providers/connect") {
      assert.equal(JSON.parse(options.body).providerId, "openrouter");
      assert.equal(JSON.parse(options.body).apiKey, "new-test-key");
      return Response.json({ token: "v1.mock", expiresAt: Date.now() + 60_000, message: "Connected" });
    }
  });
  function SettingsHarness() {
    const [open, setOpen] = React.useState(true);
    return h(React.Fragment, null,
      h("button", { onClick: () => setOpen(true) }, "Open settings"),
      h(SettingsDialog, { open, onOpenChange: setOpen }),
    );
  }
  render(app(h(SettingsHarness)));
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  const search = within(dialog).getByRole("searchbox", { name: "Search providers…" });
  await user.type(search, "unknown-provider");
  assert.ok(within(dialog).getByText("No providers match your search."));
  await user.clear(search);
  await user.type(search, "OpenRouter");
  assert.equal(within(dialog).queryByText("Anthropic"), null);
  await user.click(within(dialog).getByRole("button", { name: /OpenRouter/ }));
  const key = within(dialog).getByLabelText(/API key/);
  await user.type(key, "unfinished-key");
  await user.click(within(dialog).getByRole("button", { name: "Dismiss" }));
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  const reopened = await screen.findByRole("dialog", { name: "Settings" });
  await user.click(within(reopened).getByRole("button", { name: /OpenRouter/ }));
  const newKey = within(reopened).getByLabelText(/API key/);
  assert.equal(newKey.value, "");
  await user.type(newKey, "new-test-key");
  await user.click(within(reopened).getByRole("button", { name: "Connect", exact: true }));
  await waitFor(() => assert.ok(calls.some((call) => call.path === "/api/providers/connect")));
  await waitFor(() => assert.ok(JSON.parse(window.localStorage.getItem(storageKey)).connections.openrouter));

  await user.click(within(reopened).getByRole("button", { name: "Remove saved provider connections" }));
  const confirm = await screen.findByRole("dialog", { name: "Remove saved provider connections" });
  assert.match(confirm.textContent, /Server keys are not affected/);
  await user.click(within(confirm).getByRole("button", { name: "Remove" }));
  await waitFor(() => assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).connections.openrouter, undefined));
});

test("model picker directs an unconnected provider to its own settings card", async () => {
  seed();
  fakeFetch();
  let connectedProvider;
  render(app(h(ModelPicker, { open: true, onOpenChange() {}, onOpenSettings: (id) => { connectedProvider = id; } })));
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  await user.selectOptions(within(dialog).getByLabelText("Provider"), "openrouter");
  await user.click(await within(dialog).findByRole("button", { name: /Add a key to use this provider/ }));
  assert.equal(connectedProvider, "openrouter");
});

test("an offline model catalog does not retry endlessly and can be retried explicitly", async () => {
  seed();
  const calls = fakeFetch((path) => path.startsWith("/api/providers/models?")
    ? Response.json({ error: "offline" }, { status: 503 }) : undefined);
  render(app(h(ModelBrowser)));
  await screen.findByText("HTTP 503");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.filter((call) => call.path.startsWith("/api/providers/models?")).length, 1);
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.path.startsWith("/api/providers/models?")).length, 2));
});

test("the composer keeps a newer text draft and attachments after an earlier send finishes", async () => {
  seed();
  const blobs = new Map();
  let sequence = 0;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (file) => { const url = `blob:test-${++sequence}`; blobs.set(url, file); return url; };
  URL.revokeObjectURL = (url) => blobs.delete(url);
  fakeFetch((path) => path.startsWith("blob:") ? { blob: async () => blobs.get(path) } : undefined);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let sent;
  const onSubmit = async (message) => { sent = message; await pending; };
  try {
    render(app(h(TooltipProvider, null, h(PromptInputProvider, null, h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit })))));
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
    const upload = document.querySelector('input[type="file"]');
    await user.type(textarea, "First draft");
    await user.upload(upload, new File(["first"], "first.txt", { type: "text/plain" }));
    assert.ok(await screen.findByText("first.txt"));
    fireEvent.submit(textarea.closest("form"));
    await waitFor(() => assert.equal(sent?.text, "First draft"));
    assert.equal(sent.files[0].filename, "first.txt");
    await user.clear(textarea);
    await user.type(textarea, "Second draft");
    await user.upload(upload, new File(["second"], "second.txt", { type: "text/plain" }));
    assert.ok(await screen.findByText("second.txt"));
    await React.act(async () => { finish(); await pending; });
    assert.equal(textarea.value, "Second draft");
    assert.equal(screen.queryByText("first.txt"), null);
    assert.ok(screen.getByText("second.txt"));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("chat updates are serialized and a stale Supabase refresh cannot undo a rename", async () => {
  seed();
  let refreshCount = 0;
  let resolveStaleRefresh;
  let resolveRename;
  const staleRefresh = new Promise((resolve) => { resolveStaleRefresh = resolve; });
  const renameResponse = new Promise((resolve) => { resolveRename = resolve; });
  const original = { id: "chat-a", title: "Original", updatedAt: 1 };
  const calls = fakeFetch((path, options) => {
    if (path === "/api/chats") {
      refreshCount += 1;
      return refreshCount === 1 ? Response.json({ chats: [original] }) : staleRefresh;
    }
    if (path === "/api/chats/chat-a" && options.method === "PATCH") {
      return JSON.parse(options.body).activity ? Response.json({ ok: true, title: "Renamed" }) : renameResponse;
    }
  });
  function HistoryProbe() {
    const { settings, refreshChats, renameChat, recordChatActivity } = useAppSettings();
    return h("div", null,
      h("p", null, settings.chats[0]?.title ?? "No history"),
      h("button", { onClick: () => void refreshChats() }, "Refresh history"),
      h("button", { onClick: () => void renameChat("chat-a", "Renamed") }, "Rename"),
      h("button", { onClick: () => void recordChatActivity("chat-a", "Original") }, "Send activity"),
    );
  }
  render(app(h(HistoryProbe), "supabase"));
  const user = userEvent.setup();
  await screen.findByText("Original");
  await user.click(screen.getByRole("button", { name: "Refresh history" }));
  await user.click(screen.getByRole("button", { name: "Rename" }));
  await user.click(screen.getByRole("button", { name: "Send activity" }));
  assert.equal(calls.filter((call) => call.options.method === "PATCH").length, 1);
  await React.act(async () => { resolveRename(Response.json({ ok: true, title: "Renamed" })); await renameResponse; });
  await waitFor(() => assert.equal(calls.filter((call) => call.options.method === "PATCH").length, 2));
  const patches = calls.filter((call) => call.options.method === "PATCH");
  assert.equal(JSON.parse(patches[1].options.body).activity, true);
  await React.act(async () => { resolveStaleRefresh(Response.json({ chats: [original] })); await staleRefresh; });
  await screen.findByText("Renamed");
  assert.equal(screen.queryByText("Original"), null);
});

test("an expired provider key is identified and a new key can be tested", async () => {
  seed({ connections: { openrouter: { token: "v1.expired", source: "browser", label: "Old key", connectedAt: 1, expiresAt: 2 } } });
  const calls = fakeFetch((path, options) => {
    if (path === "/api/providers/test") {
      const body = JSON.parse(options.body);
      assert.equal(body.providerId, "openrouter");
      assert.equal(body.apiKey, "replacement-key");
      assert.equal(body.token, undefined);
      return Response.json({ message: "Tested" });
    }
  });
  render(app(h(SettingsDialog, { open: true, onOpenChange() {}, initialProvider: "openrouter" })));
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  assert.ok(within(dialog).getByText("This saved key expired. Reconnect or disconnect it."));
  await user.type(within(dialog).getByLabelText(/API key/), "replacement-key");
  await user.click(within(dialog).getByRole("button", { name: "Test", exact: true }));
  await waitFor(() => assert.ok(calls.some((call) => call.path === "/api/providers/test")));
  assert.ok(await within(dialog).findByText("Tested"));
});

test("a failed send keeps the draft available for retry", async () => {
  seed();
  fakeFetch();
  let attempted = false;
  const onSubmit = async () => { attempted = true; throw new Error("simulated failure"); };
  render(app(h(TooltipProvider, null, h(PromptInputProvider, null,
    h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit }),
  ))));
  const user = userEvent.setup();
  const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Please keep this draft");
  fireEvent.submit(textarea.closest("form"));
  await waitFor(() => assert.equal(attempted, true));
  assert.equal(textarea.value, "Please keep this draft");
});


test("the sign-in screen keeps both login choices and bilingual email-link signup", async (t) => {
  t.after(async () => { await browserSupabase().auth.dispose(); });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.match(String(url), /\/auth\/v1\/signup/);
    return Response.json({
      id: "mock-user", email: "user@example.test", app_metadata: {}, user_metadata: {},
      aud: "authenticated", created_at: "2026-01-01T00:00:00Z", identities: [],
    });
  };
  render(h(AuthScreen, { vercelAvailable: true }));
  const user = userEvent.setup();
  assert.ok(screen.getByRole("button", { name: "Continue with Vercel" }));
  assert.ok(screen.getByLabelText("Email address"));
  await user.click(screen.getByRole("button", { name: "SO" }));
  assert.ok(screen.getByRole("button", { name: "Ku sii wad Vercel" }));
  assert.ok(screen.getByRole("region", { name: "Ku saabsan Tflash" }));
  assert.equal(document.documentElement.lang, "so");
  await user.click(screen.getByRole("button", { name: "Samee akoon", exact: true }));
  await user.type(screen.getByLabelText("Magacaaga"), "User");
  await user.type(screen.getByLabelText("Cinwaanka email-ka"), "user@example.test");
  await user.type(screen.getByLabelText("Furaha sirta ah"), "password123");
  await user.type(screen.getByLabelText("Xaqiiji furaha"), "different123");
  await user.click(screen.getByRole("button", { name: "Samee akoonkaaga" }));
  assert.ok(screen.getByRole("alert").textContent.includes("Labada fure isma laha"));
  assert.equal(calls.length, 0);
  await user.clear(screen.getByLabelText("Xaqiiji furaha"));
  await user.type(screen.getByLabelText("Xaqiiji furaha"), "password123");
  await user.click(screen.getByRole("button", { name: "Samee akoonkaaga" }));
  assert.match((await screen.findByRole("status")).textContent, /xiriirka xaqiijinta/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.match(decodeURIComponent(calls[0].url), /auth\/callback\?next=/);
});
