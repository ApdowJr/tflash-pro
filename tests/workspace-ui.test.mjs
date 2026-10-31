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
const { TopBar } = await import("../components/workspace/top-bar.tsx");
const { SettingsDialog } = await import("../components/settings/settings-dialog.tsx");
const { ConnectionsPanel } = await import("../components/settings/connections-panel.tsx");
const { INTEGRATIONS } = await import("../lib/integrations/catalog.ts");
const { ModelBrowser } = await import("../components/settings/model-browser.tsx");
const { ModelPicker } = await import("../components/settings/model-picker.tsx");
const { ChatComposer } = await import("../components/chat/chat-composer.tsx");
const { AgentModePicker } = await import("../components/chat/chat-composer.tsx");
const { WorkspaceProvider, useWorkspace } = await import("../components/settings/workspace-store.tsx");
const { WorkspacePanel } = await import("../components/settings/workspace-panel.tsx");
const { workspaceStorageKey, emptyWorkspace } = await import("../lib/workspace.ts");
const { AuthScreen } = await import("../components/app/auth-screen.tsx");
const { browserSupabase } = await import("../lib/supabase/browser.ts");
const { PromptInputProvider } = await import("../components/ai-elements/prompt-input.tsx");
const { usePromptInputController } = await import("../components/ai-elements/prompt-input.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");

const realFetch = globalThis.fetch;
const h = React.createElement;
const userId = "ui-test";
const storageKey = `tflash:settings:v1:${userId}`;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function seed({ language = "en", chats = [], chatProofs = {}, connections = {}, integrationTokens = {} } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem("tflash:language", language);
  window.localStorage.setItem(storageKey, JSON.stringify({ language, chats, chatProofs, connections, integrationTokens }));
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
    if (path === "/api/integrations") return Response.json({ integrations: INTEGRATIONS.map((item) => ({ id: item.id, mode: "none", configured: false, oauthAvailable: item.id !== "github" })) });
    if (path === "/api/providers") {
      return Response.json({ providers: [{ id: "gateway", envConfigured: true }] });
    }
    if (path.startsWith("/api/providers/models?")) {
      return Response.json({ models: [{ id: "example/model", name: "Example model" }], source: "static" });
    }
    if (path.startsWith("/api/chats/") && path.endsWith("/search")) return Response.json({ status: "no-match" });
    if (path.startsWith("/api/chats/")) return Response.json({ ok: true });
    if (path === "/api/chats") return Response.json({ chats: [], storage: "browser" });
    if (path === "/api/workspace") return Response.json({ storage: "browser", workspace: null, updatedAt: null });
    throw new Error(`Unexpected request in UI test: ${path}`);
  };
  return calls;
}

test("history actions rename, confirm removal, report failure, and persist before navigation", async () => {
  seed({ chats: [{ id: "chat-a", title: "Original title", updatedAt: Date.now() }], chatProofs: { "chat-a": "owner-proof" } });
  let deleteFails = true;
  const calls = fakeFetch((path, options) => {
    if (path === "/api/chats/chat-a" && options.method === "DELETE" && deleteFails) {
      return Response.json({ error: "invalid" }, { status: 400 });
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
  assert.ok(await screen.findByText("No chats match your search."));
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
  assert.ok(await screen.findByText("Ma jiro wada hadal ku habboon raadinta."));
});

test("mobile sidebar moves focus into navigation and restores it to the opener", async () => {
  seed();
  fakeFetch();
  function SidebarHarness() {
    const [open, setOpen] = React.useState(false);
    return h(React.Fragment, null,
      h("button", { type: "button", onClick: () => setOpen(true) }, "Open navigation"),
      h(Sidebar, { open, onClose: () => setOpen(false), onNewChat() {}, onOpenSettings() {} }),
    );
  }

  render(app(h(SidebarHarness)));
  const opener = screen.getByRole("button", { name: "Open navigation" });
  await userEvent.setup().click(opener);
  const closeButton = await screen.findByRole("button", { name: "Close menu" });
  await waitFor(() => assert.equal(document.activeElement, closeButton));

  await userEvent.setup().click(closeButton);
  await waitFor(() => assert.equal(document.activeElement, opener));
});

test("Escape closes the mobile sidebar and restores focus to the menu trigger", async () => {
  seed();
  fakeFetch();
  function SidebarHarness() {
    const [open, setOpen] = React.useState(false);
    return h(React.Fragment, null,
      h("button", { type: "button", onClick: () => setOpen(true) }, "Open navigation"),
      h(Sidebar, { open, onClose: () => setOpen(false), onNewChat() {}, onOpenSettings() {} }),
    );
  }

  render(app(h(SidebarHarness)));
  const user = userEvent.setup();
  const opener = screen.getByRole("button", { name: "Open navigation" });
  await user.click(opener);
  await screen.findByRole("button", { name: "Close menu" });
  await user.keyboard("{Escape}");
  await waitFor(() => assert.equal(document.activeElement, opener));
  assert.equal(screen.queryByRole("button", { name: "Close menu" })?.closest("aside")?.className.includes("invisible"), true);
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
    assert.equal(textarea.value, "", "the submitted text clears while the send is still pending");
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


test("a failed in-flight send does not overwrite a newer draft", async () => {
  seed();
  fakeFetch();
  let rejectSend;
  let attempted = false;
  const pending = new Promise((_, reject) => { rejectSend = reject; });
  const onSubmit = async () => { attempted = true; await pending; };
  render(app(h(TooltipProvider, null, h(PromptInputProvider, null,
    h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit }),
  ))));
  const user = userEvent.setup();
  const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "First draft");
  fireEvent.submit(textarea.closest("form"));
  await waitFor(() => assert.equal(attempted, true));
  assert.equal(textarea.value, "");
  await user.type(textarea, "New draft");
  await React.act(async () => { rejectSend(new Error("offline")); try { await pending; } catch {} });
  assert.equal(textarea.value, "New draft");
  assert.ok(screen.getByRole("alert").textContent.includes("First draft"));
  const restore = screen.getByRole("button", { name: "Restore draft" });
  const dismiss = screen.getByRole("button", { name: "Dismiss" });
  assert.ok(restore.className.includes("min-h-11"));
  assert.ok(restore.className.includes("focus-visible:ring-2"));
  assert.ok(dismiss.className.includes("size-11"));
  assert.ok(dismiss.className.includes("focus-visible:ring-2"));
  await user.click(restore);
  assert.equal(textarea.value, "First draft\n\nNew draft");
  assert.equal(screen.queryByRole("alert"), null);
});

test("Connections offers direct consent links without asking users for tokens", async () => {
  seed();
  window.history.replaceState({}, "", "/s/current-chat");
  fakeFetch();
  render(app(h(ConnectionsPanel)));
  const user = userEvent.setup();
  const linear = await screen.findByRole("link", { name: "Connect Linear" });
  const url = new URL(linear.href);
  assert.equal(url.origin, window.location.origin);
  assert.equal(url.pathname, "/api/integrations/oauth/start");
  assert.equal(url.searchParams.get("id"), "linear");
  assert.equal(url.searchParams.get("returnTo"), "/s/current-chat");
  assert.ok(screen.getByRole("link", { name: "Connect Neon" }));
  assert.ok(screen.getByRole("link", { name: "Connect Stripe" }));
  assert.ok(screen.getByRole("link", { name: "Connect Resend" }));
  assert.equal(screen.queryByRole("link", { name: "Connect GitHub" }), null);
  await user.click(screen.getByRole("button", { name: /GitHub/ }));
  assert.ok(screen.getByText(/administrator needs to enable authorization/));
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.equal(screen.queryByPlaceholderText(/token/), null);
  assert.equal(screen.queryByText("Environment variables"), null);
});

test("OAuth return marks only the approved connection as connected and supports disconnect", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name, _options, fn) => fn({}) } });
  seed({ language: "so" });
  window.history.replaceState({}, "", "/s/current-chat?integration=linear&connected=1");
  fakeFetch((path) => path === "/api/integrations/oauth/result" ? Response.json({
    connected: true, integrationId: "linear", token: "v1.sealed-grant", expiresAt: Date.now() + 86400000,
    tokenExpiresAt: Date.now() + 3600000, refreshable: true,
  }) : undefined);
  render(app(h(ConnectionsPanel)));
  assert.ok(await screen.findByRole("status"));
  const linearRow = screen.getByRole("button", { name: /Linear Ku xiran/ }).closest("div").parentElement;
  assert.ok(within(linearRow).getByRole("button", { name: "Ka saar" }));
  assert.equal(within(linearRow).queryByRole("link", { name: "Ku xir Linear" }), null);
  assert.equal(window.location.pathname, "/s/current-chat");
  assert.equal(window.location.search, "");
  await waitFor(() => assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear?.source, "oauth"));
  const record = JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear;
  assert.equal(record.source, "oauth");
  assert.equal(record.token, "v1.sealed-grant");
  await userEvent.setup().click(within(linearRow).getByRole("button", { name: "Ka saar" }));
  assert.ok(await screen.findByRole("link", { name: "Ku xir Linear" }));
  delete navigator.locks;
});

test("a forged or lost OAuth handoff does not show a connection success", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name, _options, fn) => fn({}) } });
  seed();
  window.history.replaceState({}, "", "/?integration=linear&connected=1");
  fakeFetch((path) => path === "/api/integrations/oauth/result" ? Response.json({ connected: false }) : undefined);
  render(app(h(ConnectionsPanel)));
  assert.ok(await screen.findByText(/provider may have created an OAuth client or granted access/i));
  assert.equal(screen.queryByText("Connected with one-tap authorization."), null);
  assert.equal(screen.queryByRole("link", { name: "Connect Linear" }), null);
  assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear, undefined);
  delete navigator.locks;
});

test("a denied OAuth flow keeps the service disconnected", async () => {
  seed();
  window.history.replaceState({}, "", "/?integration=linear&oauth=denied");
  fakeFetch();
  render(app(h(ConnectionsPanel)));
  assert.match((await screen.findByRole("alert")).textContent, /Authorization was cancelled/);
  assert.equal(screen.queryByRole("status"), null);
  assert.ok(await screen.findByRole("link", { name: "Connect Linear" }));
});

test("an in-flight renewal cannot reconnect a grant after the user disconnects it", async () => {
  seed({ integrationTokens: { linear: { token: "v1.original", label: "Authorized", connectedAt: Date.now(),
    tokenExpiresAt: Date.now() + 60000, expiresAt: Date.now() + 86400000, refreshable: true, source: "oauth" } } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name, _options, fn) => fn({}) } });
  let finish;
  const renewal = new Promise((resolve) => { finish = resolve; });
  const calls = fakeFetch((path) => path === "/api/integrations/oauth/refresh" ? renewal : undefined);
  try {
    render(app(h(ConnectionsPanel)));
    await waitFor(() => assert.ok(calls.some((item) => item.path === "/api/integrations/oauth/refresh")));
    await userEvent.setup().click(screen.getByRole("button", { name: "Disconnect" }));
    await React.act(async () => {
      finish(Response.json({ ok: true, token: "v1.renewed", expiresAt: Date.now() + 86400000, tokenExpiresAt: Date.now() + 3600000 }));
      await renewal;
    });
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear, undefined);
    assert.ok(await screen.findByRole("link", { name: "Connect Linear" }));
  } finally { delete navigator.locks; }
});

test("a second identical draft survives completion of an earlier send", async () => {
  seed();
  fakeFetch();
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  render(app(h(TooltipProvider, null, h(PromptInputProvider, null,
    h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit: async () => { await pending; } }),
  ))));
  const user = userEvent.setup();
  const textarea = screen.getByPlaceholderText("Ask Tflash anything…");
  await user.type(textarea, "Same words");
  fireEvent.submit(textarea.closest("form"));
  assert.equal(textarea.value, "");
  await user.type(textarea, "Same words");
  await React.act(async () => { finish(); await pending; });
  assert.equal(textarea.value, "Same words");
});

test("attachment removal has a 44px touch target and a visible keyboard focus indicator", async () => {
  seed();
  fakeFetch();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:attachment-test";
  URL.revokeObjectURL = () => {};
  function AttachmentHarness() {
    const controller = usePromptInputController();
    return h("button", { type: "button", onClick: () => controller.attachments.add([new File(["content"], "notes.txt", { type: "text/plain" })]) }, "Add test attachment");
  }
  try {
    render(app(h(TooltipProvider, null, h(PromptInputProvider, null,
      h(AttachmentHarness),
      h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit: async () => {} }),
    ))));
    await userEvent.setup().click(screen.getByRole("button", { name: "Add test attachment" }));
    const remove = await screen.findByRole("button", { name: "Remove attachment: notes.txt" });
    assert.ok(remove.className.includes("size-11"));
    assert.ok(remove.className.includes("tf-touch-target"));
    assert.ok(remove.className.includes("focus-visible:ring-2"));
    await userEvent.setup().click(remove);
    assert.equal(screen.queryByText("notes.txt"), null);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
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

test("task progress is bilingual and a blocked step is not shown as completed", async () => {
  const { AgentPlanCard } = await import("../components/chat/agent-workspace.tsx");
  seed({ language: "so" });
  fakeFetch();
  render(app(h(AgentPlanCard, { plan: { title: "Diyaari warbixin", steps: [
    { id: "one", title: "Akhrinta", status: "completed" },
    { id: "two", title: "Dirista", status: "blocked", detail: "Oggolaansho ma jiro" },
  ] } })));
  const panel = await screen.findByRole("region", { name: "Qorshaha hawsha" });
  assert.ok(within(panel).getByText("Xanniban", { exact: false }));
  assert.ok(within(panel).getByText("Oggolaansho ma jiro"));
  assert.ok(within(panel).getByText(/1\/2 Dhammaatay/));
  assert.equal(within(panel).getAllByRole("listitem").length, 2);
});

test("artifact preview is inert text and downloading uses the exact generated content", async () => {
  const { AgentArtifactCard } = await import("../components/chat/agent-workspace.tsx");
  seed();
  fakeFetch();
  const content = '<script>window.injected = true</script>\n# Deliverable';
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let savedBlob;
  let savedFilename;
  URL.createObjectURL = (blob) => { savedBlob = blob; return "blob:artifact-test"; };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { savedFilename = this.download; };
  try {
    render(app(h(AgentArtifactCard, { artifact: { filename: "report.md", description: "Finished report", content } })));
    await userEvent.setup().click(screen.getByText("Preview content"));
    assert.equal(document.querySelector("pre").textContent, content);
    assert.equal(document.querySelector("script"), null);
    assert.equal(window.injected, undefined);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download: report.md" }));
    assert.equal(savedFilename, "report.md");
    assert.equal(savedBlob.type, "text/markdown;charset=utf-8");
    const actual = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(savedBlob);
    });
    assert.equal(actual, content);
    // Let the component release its temporary download URL before restoring mocks.
    await new Promise((resolve) => window.setTimeout(resolve, 1050));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("unfinished stopped plans can be continued explicitly, but completed or active plans cannot", async () => {
  const { AgentPlanCard } = await import("../components/chat/agent-workspace.tsx");
  seed();
  fakeFetch();
  let attempts = 0;
  let rejectAttempt;
  const pending = new Promise((_, reject) => { rejectAttempt = reject; });
  const onContinue = async () => { attempts++; await pending; };
  const plan = { title: "Write report", steps: [{ id: "write", title: "Write", status: "pending" }] };
  const rendered = render(app(h(AgentPlanCard, { plan, runState: "idle", onContinue })));
  const user = userEvent.setup();
  const continueButton = await screen.findByRole("button", { name: "Continue task" });
  fireEvent.click(continueButton);
  assert.equal(attempts, 0);
  assert.equal(screen.getByRole("button", { name: "Start new turn" }).disabled, true);
  await user.click(screen.getByRole("checkbox", { name: /I reviewed the recent activity/ }));
  const confirm = screen.getByRole("button", { name: "Start new turn" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  assert.equal(attempts, 1);
  assert.equal(screen.getByRole("button", { name: "Working" }).disabled, true);
  await React.act(async () => { rejectAttempt(new Error("offline")); try { await pending; } catch {} });
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.getByRole("button", { name: "Start new turn" }).disabled, true);
  await user.click(screen.getByRole("checkbox", { name: /I reviewed the recent activity/ }));
  assert.equal(screen.getByRole("button", { name: "Start new turn" }).disabled, false);
  rendered.rerender(app(h(AgentPlanCard, { plan, runState: "working", onContinue })));
  assert.equal(screen.queryByRole("button", { name: "Continue task" }), null);
  rendered.rerender(app(h(AgentPlanCard, { plan: { ...plan, steps: [{ ...plan.steps[0], status: "completed" }] }, runState: "idle", onContinue })));
  assert.equal(screen.queryByRole("button", { name: "Continue task" }), null);
  assert.ok(screen.getByRole("button", { name: "Review / continue task" }));
});

test("actual chat messages render authored artifacts and reject a lookalike from another tool", async () => {
  const { AgentMessage } = await import("../components/chat/agent-message.tsx");
  seed();
  fakeFetch();
  const output = { kind: "tflash-artifact", version: 1, artifact: { filename: "result.txt", description: "Result", content: "Done" } };
  const part = { type: "dynamic-tool", toolName: "create_artifact", toolCallId: "call-1", state: "output-available", input: {}, output };
  const props = { canRespond: () => false, isStreaming: false, onInputResponses() {}, questionsFor: () => [], message: { id: "assistant-1", role: "assistant", parts: [part] } };
  const rendered = render(app(h(AgentMessage, props)));
  assert.ok(await screen.findByRole("button", { name: "Download: result.txt" }));
  rendered.rerender(app(h(AgentMessage, { ...props, message: { ...props.message, parts: [{ ...part, toolName: "unknown_tool" }] } })));
  assert.equal(screen.queryByRole("button", { name: "Download: result.txt" }), null);
});

test("research messages show inert bilingual sources and download the actual executor-generated report", async () => {
  const { AgentMessage } = await import("../components/chat/agent-message.tsx");
  const fetchTool = (await import("../agent/tools/web_fetch.ts")).default;
  const reportTool = (await import("../agent/tools/create_research_report.ts")).default;
  const context = { approval: { responder: { principalId: userId } }, session: { id: "ui-research", auth: { current: { principalId: userId, principalType: "user" } } } };
  globalThis.fetch = async () => new Response('<script>window.researchInjected=true</script> Sample size: 42.', { headers: { "content-type": "text/plain" } });
  const fetched = await fetchTool.execute({ url: "https://example.com/study" }, context);
  const result = await reportTool.execute({ filename: "study.md", language: "en", title: "Study", summary: "Small sample", receipts: [fetched.receipt], findings: [{ claim: "Sample size: 42", sources: [1] }], limitations: ["Single source, not independently verified"] }, context);
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let savedBlob;
  let savedFilename;
  URL.createObjectURL = (blob) => { savedBlob = blob; return "blob:research-test"; };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { savedFilename = this.download; };
  const props = (toolName, output, state = "output-available") => ({ canRespond: () => false, isStreaming: false, onInputResponses() {}, questionsFor: () => [], message: { id: "research-msg", role: "assistant", parts: [{ type: "dynamic-tool", toolName, toolCallId: "research-call", state, input: {}, output }] } });
  try {
    seed(); fakeFetch();
    const rendered = render(app(h(AgentMessage, props("web_fetch", fetched))));
    const card = await screen.findByRole("region", { name: "Fetched source" });
    const link = within(card).getByRole("link");
    assert.equal(link.href, "https://example.com/study");
    assert.equal(link.rel, "noopener noreferrer");
    await userEvent.setup().click(within(card).getByText("Retrieved excerpt"));
    assert.ok(card.textContent.includes("<script>"));
    assert.equal(card.querySelector("script"), null);
    assert.equal(window.researchInjected, undefined);
    assert.ok(!card.textContent.includes(fetched.receipt));
    rendered.rerender(app(h(AgentMessage, props("create_research_report", result))));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Download: study.md" }));
    assert.equal(savedFilename, "study.md");
    const actual = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(savedBlob);
    });
    assert.equal(actual, result.artifact.content);
    assert.ok(actual.includes("[1]: <https://example.com/study>"));
    for (const [name, output, state] of [
      ["unknown_tool", result, "output-available"],
      ["create_research_report", result, "input-available"],
      ["create_research_report", { ...result, sources: [{ ...fetched.source, url: "javascript:alert(1)" }] }, "output-available"],
    ]) {
      rendered.rerender(app(h(AgentMessage, props(name, output, state))));
      assert.equal(screen.queryByRole("button", { name: "Download: study.md" }), null);
    }
    rendered.unmount();
    seed({ language: "so" }); fakeFetch();
    render(app(h(AgentMessage, props("create_research_report", result))));
    assert.ok(await screen.findByRole("region", { name: "Warbixinta baarista" }));
    assert.ok(screen.getByRole("button", { name: "Soo dejiso: study.md" }));
    await userEvent.setup().click(screen.getByText("Ilaha la akhriyey (1)"));
    assert.ok(screen.getByRole("region", { name: "Isha la akhriyey" }));
    await new Promise((resolve) => window.setTimeout(resolve, 1050));
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("projects and opt-in editable memory persist locally, remain account-isolated and delete with confirmation", async () => {
  const { WorkspacePanel, ProjectPicker } = await import("../components/settings/workspace-panel.tsx");
  const { useWorkspace } = await import("../components/settings/workspace-store.tsx");
  const { workspaceContext } = await import("../lib/workspace.ts");
  let snapshot;
  function Probe() { const store = useWorkspace(); snapshot = store.workspace; return h("output", { "data-testid": "context" }, workspaceContext(store.workspace, "project-chat")); }
  seed(); fakeFetch();
  const content = h(React.Fragment, null, h(WorkspacePanel), h(ProjectPicker, { sessionId: "project-chat" }), h(Probe));
  const rendered = render(app(content)); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New project" }));
  await user.type(screen.getByLabelText("Project name"), "School");
  await user.type(screen.getByLabelText("Project instructions"), "Use primary sources");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Projects", exact: true }), snapshot.projects[0].id);
  assert.ok(screen.getByTestId("context").textContent.includes("Use primary sources"));
  await user.click(screen.getByRole("button", { name: "Add note" }));
  await user.type(screen.getByLabelText("Memory note"), "Prefer short answers <script>inert</script>");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  assert.equal(snapshot.notes.length, 1);
  assert.ok(!screen.getByTestId("context").textContent.includes("Prefer short"));
  await user.click(screen.getByRole("checkbox", { name: "Use saved notes in future messages" }));
  assert.ok(screen.getByTestId("context").textContent.includes("Prefer short"));
  assert.equal(document.querySelector("script"), null);
  await user.click(screen.getByRole("button", { name: "Edit note" }));
  await user.clear(screen.getByLabelText("Memory note")); await user.type(screen.getByLabelText("Memory note"), "Updated preference");
  await user.click(screen.getByRole("button", { name: "Save", exact: true }));
  assert.ok(screen.getByTestId("context").textContent.includes("Updated preference"));
  rendered.rerender(app(content, "supabase"));
  await waitFor(() => assert.equal(snapshot.notes.length, 0));
  assert.equal(snapshot.projects.length, 0);
  rendered.rerender(h(AppSettingsProvider, { userId: "another-account", accountKind: "vercel" }, content));
  await waitFor(() => assert.equal(snapshot.notes.length, 0));
  assert.equal(snapshot.projects.length, 0);
  rendered.rerender(app(content, "vercel"));
  await waitFor(() => assert.equal(snapshot.notes.length, 1));
  await user.click(screen.getByRole("button", { name: "Remove: Updated preference" }));
  assert.equal(snapshot.notes.length, 1);
  const confirm = screen.getByRole("alertdialog", { name: "Remove" });
  await user.click(within(confirm).getByRole("button", { name: "Remove", exact: true }));
  assert.equal(snapshot.notes.length, 0);
  assert.ok(!screen.getByTestId("context").textContent.includes("Updated preference"));
});

test("workspace storage failures never present a successful write", async () => {
  const { WorkspacePanel } = await import("../components/settings/workspace-panel.tsx");
  seed(); fakeFetch(); render(app(h(WorkspacePanel)));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New project" }));
  await user.type(screen.getByLabelText("Project name"), "Unsaved project");
  const original = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (key, value) { if (key.startsWith("tflash:workspace")) throw new Error("Quota exceeded"); return original.call(this, key, value); };
  try {
    await user.click(screen.getByRole("button", { name: "Save", exact: true }));
    assert.ok(screen.getByRole("alert").textContent.includes("Could not save workspace"));
    assert.equal(screen.queryByRole("button", { name: "Edit project" }), null);
    assert.equal(screen.getByLabelText("Project name").value, "Unsaved project");
  } finally { window.Storage.prototype.setItem = original; }
});

test("activity UI uses authoritative results, hides arguments and keeps unreported cost unknown", async () => {
  const { ActivityPanel } = await import("../components/chat/activity-panel.tsx");
  seed({ language: "so" }); fakeFetch();
  render(app(h(ActivityPanel, { messages: [{ id: "msg", role: "assistant", parts: [
    { type: "dynamic-tool", toolName: "bash", toolCallId: "call", state: "output-denied", input: { token: "DO-NOT-SHOW" }, approval: { id: "approval", approved: false } },
  ] }], events: [{ type: "step.completed", data: { turnId: "t", stepIndex: 0, usage: { inputTokens: 5, outputTokens: 2 } } }] })));
  await userEvent.setup().click(await screen.findByText("Ficillada iyo isticmaalka"));
  assert.ok(await screen.findByText("Ficillada iyo isticmaalka · 1"));
  assert.ok(screen.getByText("La diiday")); assert.ok(screen.getByText("Lama soo sheegin"));
  assert.ok(!document.body.textContent.includes("DO-NOT-SHOW"));
});

test("document imports create inert text attachments without sending, exports are explicit binary downloads", async () => {
  const { DocumentExportButtons, DocumentImportButton } = await import("../components/chat/documents.tsx");
  const { usePromptInputAttachments } = await import("../components/ai-elements/prompt-input.tsx");
  let attachments;
  function Reader() { attachments = usePromptInputAttachments(); return h(DocumentImportButton); }
  seed(); const calls = [];
  fakeFetch((path, options) => {
    if (path === "/api/documents/read") { calls.push(path); return Response.json({ text: "Extracted <script>not executed</script>", truncated: true }); }
    if (path === "/api/documents/export") { calls.push(path); return new Response("%PDF-1.7\nfixture", { headers: { "content-type": "application/pdf" } }); }
  });
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalClick = window.HTMLAnchorElement.prototype.click;
  let savedFilename; URL.createObjectURL = () => "blob:document"; URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { savedFilename = this.download; };
  try {
    render(app(h(TooltipProvider, null, h(PromptInputProvider, null, h(Reader), h(DocumentExportButtons, { filename: "report.md", content: "Report" })))));
    assert.equal(calls.length, 0);
    const input = screen.getByLabelText("Read PDF or DOCX", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["%PDF-fixture"], "study.pdf", { type: "application/pdf" })] } });
    await waitFor(() => assert.equal(attachments.files.length, 1));
    assert.match(attachments.files[0].filename, /study.pdf.extracted.txt/);
    assert.ok(screen.getByText("Only part of this document was extracted."));
    assert.equal(document.querySelector("script"), null);
    await userEvent.setup().click(screen.getByRole("button", { name: "PDF", exact: true }));
    assert.equal(savedFilename, "report.pdf");
    assert.deepEqual(calls, ["/api/documents/read", "/api/documents/export"]);
    await new Promise((resolve) => window.setTimeout(resolve, 1050));
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; window.HTMLAnchorElement.prototype.click = originalClick; }
});

test("actual chat submits only selected memory/project context, enforces the wire limit setting and sends extracted documents as text", async () => {
  const { registerHooks } = await import("node:module");
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "eve/react") return { url: "data:text/javascript,export function useEveAgent(options) { globalThis.__chatOptions = options; return globalThis.__chatMock; }", shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const { AgentChat } = await import("../components/chat/agent-chat.tsx");
  const { useWorkspace } = await import("../components/settings/workspace-store.tsx");
  const { emptyWorkspace, workspaceStorageKey } = await import("../lib/workspace.ts");
  seed({ chatProofs: { "owned-chat": "test-proof" } });
  const wkey = workspaceStorageKey("vercel", userId);
  window.localStorage.setItem(wkey, JSON.stringify({ ...emptyWorkspace(), memoryEnabled: true, maxSteps: 2, projects: [
    { id: "school", name: "School", instructions: "Use primary sources", chatIds: ["owned-chat"] },
    { id: "other", name: "Other", instructions: "Do not send other project", chatIds: [] },
  ], notes: [
    { id: "global", text: "Selected memory", enabled: true, projectId: null },
    { id: "other-note", text: "Unrelated memory", enabled: true, projectId: "other" },
  ] }));
  const blobs = new Map();
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { const url = `blob:test-chat-${blobs.size}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  fakeFetch((path) => path.startsWith("blob:") ? { blob: async () => blobs.get(path) } : path === "/api/documents/read" ? Response.json({ text: "Actual extracted document body", truncated: false }) : undefined);
  const sends = [];
  globalThis.__chatMock = { status: "ready", events: [], data: { messages: [], inputs: {} }, send: async (message, options) => { sends.push({ message, options }); }, respond: async () => {}, cancel: async () => {} };
  let store;
  function Probe() { store = useWorkspace(); return null; }
  try {
    render(app(h(TooltipProvider, null, h(Probe), h(AgentChat, { account: { id: userId, kind: "vercel", name: "Test", email: "test@example.test" }, sessionId: "owned-chat" }))));
    const user = userEvent.setup();
    await waitFor(() => assert.equal(screen.getByPlaceholderText("Ask Tflash anything…").disabled, false));
    await user.type(screen.getByPlaceholderText("Ask Tflash anything…"), "Read this document");
    fireEvent.change(screen.getByLabelText("Read PDF or DOCX", { selector: "input" }), { target: { files: [new File(["%PDF-fixture"], "study.pdf", { type: "application/pdf" })] } });
    await screen.findByText("study.pdf.extracted.txt");
    await waitFor(() => assert.equal(screen.getByRole("button", { name: "Send" }).disabled, false));
    fireEvent.submit(screen.getByPlaceholderText("Ask Tflash anything…").closest("form"));
    await waitFor(() => assert.equal(sends.length, 1));
    assert.ok(sends[0].options.clientContext.includes("Use primary sources"));
    assert.ok(sends[0].options.clientContext.includes("Selected memory"));
    assert.ok(!sends[0].options.clientContext.includes("Unrelated memory"));
    assert.equal(globalThis.__chatOptions.headers()["x-tflash-max-steps"], "2");
    assert.equal(globalThis.__chatOptions.headers()["x-tflash-owner-proof"], "test-proof");
    assert.ok(sends[0].message.some((part) => part.type === "text" && part.text.includes("Actual extracted document body")));
    assert.ok(sends[0].message.every((part) => part.type === "text"));
    await React.act(async () => { store.change((w) => ({ ...w, memoryEnabled: false })); });
    await user.type(screen.getByPlaceholderText("Ask Tflash anything…"), "Next question");
    fireEvent.submit(screen.getByPlaceholderText("Ask Tflash anything…").closest("form"));
    await waitFor(() => assert.equal(sends.length, 2));
    assert.ok(!sends[1].options.clientContext.includes("Selected memory"));
    assert.ok(sends[1].options.clientContext.includes("Use primary sources"));
  } finally { hook.deregister(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test("workspace edits merge the latest tab data, refuse corrupt overwrites and allow explicit clear recovery", async () => {
  const { WorkspacePanel } = await import("../components/settings/workspace-panel.tsx");
  const { emptyWorkspace, workspaceStorageKey } = await import("../lib/workspace.ts");
  seed(); fakeFetch(); render(app(h(WorkspacePanel))); const user = userEvent.setup();
  await screen.findByRole("button", { name: "New project" });
  const key = workspaceStorageKey("vercel", userId);
  window.localStorage.setItem(key, JSON.stringify({ ...emptyWorkspace(), projects: [{ id: "other-tab", name: "Other tab project", instructions: "", chatIds: [] }] }));
  await user.click(screen.getByRole("checkbox", { name: "Use saved notes in future messages" }));
  assert.ok(screen.getByText("Other tab project"));
  assert.equal(JSON.parse(window.localStorage.getItem(key)).memoryEnabled, true);
  window.localStorage.setItem(key, "corrupt data");
  await user.click(screen.getByRole("checkbox", { name: "Use saved notes in future messages" }));
  assert.ok(screen.getByRole("alert").textContent.includes("Could not save workspace"));
  assert.equal(window.localStorage.getItem(key), "corrupt data");
  await user.click(screen.getByRole("button", { name: "Clear projects and notes" }));
  await user.click(within(screen.getByRole("alertdialog", { name: "Remove" })).getByRole("button", { name: "Remove", exact: true }));
  assert.equal(window.localStorage.getItem(key), null);
  assert.equal(screen.queryByText("Other tab project"), null);
});

test("settings tabs expose tab semantics and support arrow, Home, and End navigation", async () => {
  seed();
  fakeFetch();
  render(app(h(SettingsDialog, { open: true, onOpenChange() {} })));
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  const providers = within(dialog).getByRole("tab", { name: "Providers" });
  const connections = within(dialog).getByRole("tab", { name: "Connections" });
  const preferences = within(dialog).getByRole("tab", { name: "Preferences" });
  const workspace = within(dialog).getByRole("tab", { name: "Workspace" });
  assert.equal(providers.getAttribute("aria-selected"), "true");
  assert.equal(providers.tabIndex, 0);
  assert.equal(connections.tabIndex, -1);
  assert.equal(within(dialog).getByRole("tabpanel").getAttribute("aria-labelledby"), providers.id);
  const user = userEvent.setup();
  providers.focus();
  await user.keyboard("{ArrowRight}");
  assert.equal(document.activeElement, connections);
  assert.equal(connections.getAttribute("aria-selected"), "true");
  await user.keyboard("{ArrowRight}");
  assert.equal(document.activeElement, preferences);
  await user.keyboard("{End}");
  assert.equal(document.activeElement, workspace);
  assert.equal(workspace.getAttribute("aria-selected"), "true");
  await user.keyboard("{Home}");
  assert.equal(document.activeElement, providers);
  assert.equal(providers.getAttribute("aria-selected"), "true");
});

test("connection accordions expose their panel relationship and mobile focus target", async () => {
  seed();
  fakeFetch();
  render(app(h(ConnectionsPanel)));
  const toggle = await screen.findByRole("button", { name: /Linear/ });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), "integration-panel-linear");
  assert.ok(toggle.className.includes("min-h-11"));
  const user = userEvent.setup();
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const panel = screen.getByRole("region", { name: toggle.getAttribute("aria-label") });
  assert.equal(panel.id, "integration-panel-linear");
  assert.equal(panel.getAttribute("aria-labelledby"), toggle.id);
  await user.keyboard("{Enter}");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("region", { name: toggle.getAttribute("aria-label") }), null);
});


test("top bar controls expose mobile-sized touch targets and visible keyboard focus", () => {
  seed();
  render(app(h(TopBar, {
    title: "Test chat",
    canExport: true,
    onExportChat() {},
    onNewChat() {},
    onOpenSidebar() {},
    sidebarOpen: false,
    onOpenSettings() {},
    onOpenModels() {},
  })));
  const header = screen.getByRole("banner");
  const menu = within(header).getByRole("button", { name: /open menu/i });
  const model = within(header).getByRole("button", { name: /choose (a )?model/i });
  const more = within(header).getByRole("button", { name: /more actions/i });
  for (const button of [menu, model, more]) {
    assert.ok(button.className.includes("min-h-11"), "control should be at least 44px tall");
    assert.ok(button.className.includes("focus-visible:ring-2"), "control should show keyboard focus");
  }
});


test("agent mode selector exposes three accessible choices and changes the selected mode", async () => {
  const selected = [];
  render(h(AgentModePicker, { mode: "chat", onChange: (mode) => selected.push(mode), language: "so", disabled: false }));
  const group = screen.getByRole("group", { name: "Habka agent-ka" });
  assert.equal(within(group).getAllByRole("button").length, 3);
  assert.equal(screen.getByRole("button", { name: "Sheeko" }).getAttribute("aria-pressed"), "true");
  await userEvent.click(screen.getByRole("button", { name: "Cilmi-baaris" }));
  assert.deepEqual(selected, ["research"]);
});


test("workspace cross-tab updates use the latest cloud revision", async () => {
  const writes = [];
  const revisions = ["2026-10-29T12:00:00.000Z", "2026-10-29T12:00:00.001Z"];
  let nextRevision = 0;
  let revision = null;
  let cloudWorkspace = null;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      writes.push({ body, expectedUserId: new Headers(options.headers).get("x-tflash-expected-user-id") });
      if (body.expectedUpdatedAt !== revision) return Response.json({ error: "conflict", changeNotStarted: true }, { status: 409 });
      cloudWorkspace = body.workspace;
      revision = revisions[nextRevision++];
      return Response.json({ ok: true, storage: "cloud", updatedAt: revision });
    }
    return Response.json({ storage: "cloud", workspace: cloudWorkspace, updatedAt: revision });
  };
  function Probe() {
    const { workspace, syncStatus } = useWorkspace();
    return h("div", {}, ...workspace.projects.map((project) => h("span", { key: project.id }, project.name)), h("p", { role: "status" }, syncStatus));
  }
  render(h(WorkspaceProvider, { kind: "supabase", userId: "cross-tab-test", children: h(Probe) }));
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, "synced"));
  const updated = { ...emptyWorkspace(), projects: [{ id: "cross-tab-project", name: "Cross-tab edit", instructions: "", chatIds: [] }] };
  const eventKey = workspaceStorageKey("supabase", "cross-tab-test");
  const eventValue = JSON.stringify(updated);
  const storageEvent = new dom.window.StorageEvent("storage", {
    key: eventKey,
    oldValue: null,
    newValue: eventValue,
  });
  assert.equal(storageEvent.key, eventKey);
  assert.equal(storageEvent.newValue, eventValue);
  await React.act(async () => {
    window.dispatchEvent(storageEvent);
  });
  await waitFor(() => assert.ok(screen.getByText("Cross-tab edit")));
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, "synced"));
  assert.deepEqual(writes.at(-1).body.workspace, updated);
  assert.equal(writes.at(-1).expectedUserId, "cross-tab-test");
  assert.equal(writes.at(-1).body.expectedUpdatedAt, revisions[0]);
});

test("a stale write 409 preserves the browser draft and newer cloud copy until resolution", async () => {
  const initial = emptyWorkspace();
  const newerCloud = { ...emptyWorkspace(), maxSteps: 17 };
  const initialRevision = "2026-10-29T12:00:00.000Z";
  let cloudWorkspace = initial;
  let revision = initialRevision;
  let injectedConcurrentWrite = false;
  const calls = fakeFetch((path, options = {}) => {
    if (path !== "/api/workspace") return undefined;
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      if (!injectedConcurrentWrite) {
        injectedConcurrentWrite = true;
        cloudWorkspace = newerCloud;
        revision = "2026-10-29T12:00:00.001Z";
        assert.equal(body.expectedUpdatedAt, initialRevision);
        return Response.json({ error: "Workspace changed elsewhere." }, { status: 409 });
      }
      return Response.json({ ok: true, storage: "cloud", updatedAt: "2026-10-29T12:00:00.002Z" });
    }
    return Response.json({ storage: "cloud", workspace: cloudWorkspace, updatedAt: revision });
  });
  render(app(h(WorkspacePanel), "supabase"));
  const memoryToggle = await screen.findByRole("checkbox", { name: "Use saved notes in future messages" });
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, "Workspace synced to your signed-in account. Memory remains opt-in; avoid storing secrets."));

  await userEvent.click(memoryToggle);

  await screen.findByText("This device's copy is preserved. Keeping it replaces the cloud copy; using cloud replaces this device's copy.");
  const localWorkspace = JSON.parse(window.localStorage.getItem(workspaceStorageKey("supabase", userId)));
  assert.equal(localWorkspace.memoryEnabled, true);
  assert.deepEqual(cloudWorkspace, newerCloud);
  assert.equal(calls.filter((call) => call.path === "/api/workspace" && call.options.method === "PUT").length, 1);
});

test("workspace conflicts preserve both copies until the user chooses the cloud copy", async () => {
  const local = { ...emptyWorkspace(), projects: [{ id: "local-project", name: "Local draft", instructions: "", chatIds: [] }] };
  const cloud = { ...emptyWorkspace(), projects: [{ id: "cloud-project", name: "Cloud saved", instructions: "", chatIds: [] }] };
  window.localStorage.setItem(workspaceStorageKey("supabase", userId), JSON.stringify(local));
  const calls = fakeFetch((path, options = {}) => {
    if (path !== "/api/workspace") return undefined;
    if (options.method === "PUT") return Response.json({ ok: true, storage: "cloud", updatedAt: "2026-10-29T12:00:00.001Z" });
    return Response.json({ storage: "cloud", workspace: cloud, updatedAt: "2026-10-29T12:00:00.000Z" });
  });
  render(app(h(WorkspacePanel), "supabase"));
  await screen.findByText("Local draft");
  await screen.findByText("This device's copy is preserved. Keeping it replaces the cloud copy; using cloud replaces this device's copy.");
  assert.equal(screen.queryByText("Cloud saved"), null);
  await React.act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Use cloud copy (replace this device)" }));
  });
  await screen.findByText("Cloud saved");
  assert.deepEqual(JSON.parse(window.localStorage.getItem(workspaceStorageKey("supabase", userId))), cloud);
  assert.equal(calls.filter((call) => call.path === "/api/workspace" && call.options.method === "PUT").length, 0);
});

test("keeping the browser copy refreshes the revision before an explicit cloud replacement", async () => {
  const local = { ...emptyWorkspace(), projects: [{ id: "local-project", name: "Local draft", instructions: "", chatIds: [] }] };
  const cloud = { ...emptyWorkspace(), projects: [{ id: "cloud-project", name: "Cloud saved", instructions: "", chatIds: [] }] };
  const latestCloud = { ...emptyWorkspace(), maxSteps: 17 };
  window.localStorage.setItem(workspaceStorageKey("supabase", userId), JSON.stringify(local));
  let getCount = 0;
  let write;
  const calls = fakeFetch((path, options = {}) => {
    if (path !== "/api/workspace") return undefined;
    if (options.method === "PUT") {
      write = { body: JSON.parse(options.body), expectedUserId: new Headers(options.headers).get("x-tflash-expected-user-id") };
      return Response.json({ ok: true, storage: "cloud", updatedAt: "2026-10-29T12:00:00.002Z" });
    }
    getCount += 1;
    return getCount === 1
      ? Response.json({ storage: "cloud", workspace: cloud, updatedAt: "2026-10-29T12:00:00.000Z" })
      : Response.json({ storage: "cloud", workspace: latestCloud, updatedAt: "2026-10-29T12:00:00.001Z" });
  });
  render(app(h(WorkspacePanel), "supabase"));
  await screen.findByText("Local draft");
  await React.act(async () => {
    await userEvent.click(screen.getByRole("button", { name: "Keep this device's copy (replace cloud)" }));
  });
  await waitFor(() => assert.equal(screen.getByRole("status").textContent, "Workspace synced to your signed-in account. Memory remains opt-in; avoid storing secrets."));
  assert.equal(write.expectedUserId, userId);
  assert.equal(write.body.expectedUpdatedAt, "2026-10-29T12:00:00.001Z");
  assert.deepEqual(write.body.workspace, local);
  assert.ok(screen.getByText("Local draft"));
  assert.ok(calls.some((call) => call.path === "/api/workspace" && call.options.method !== "PUT"));
});



test("chat search keeps title results, adds matching message excerpts, and reports/retries partial failures", async () => {
  seed({
    chats: [
      { id: "title", title: "Needle title", updatedAt: 3 },
      { id: "content", title: "API notes", updatedAt: 2 },
      { id: "expired", title: "Old chat", updatedAt: 1 },
    ],
    chatProofs: { title: "proof-title", content: "proof-content", expired: "proof-expired" },
  });
  let expired = true;
  const calls = fakeFetch((path) => {
    if (path === "/api/chats/content/search") return Response.json({ status: "matched", snippet: { before: "A useful ", match: "NEEDLE", after: " in the answer" } });
    if (path === "/api/chats/expired/search") return Response.json({ status: expired ? "unavailable" : "no-match" });
  });
  render(app(h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} })));
  const user = userEvent.setup();
  const search = await screen.findByRole("searchbox", { name: "Search chats…" });
  await user.type(search, "needle");
  assert.ok(screen.getByRole("link", { name: "Needle title" }));
  assert.ok(screen.getByText(/Searching messages/));
  assert.equal(screen.queryByText("No chats match your search."), null);
  const link = await screen.findByRole("link", { name: /API notes.*NEEDLE/ });
  assert.equal(link.getAttribute("href"), "/s/content");
  assert.equal(within(link).getByText("NEEDLE").tagName, "MARK");
  assert.ok(await screen.findByText(/Some chats could not be searched/));
  assert.equal(screen.queryByText("No chats match your search."), null);
  assert.equal(calls.filter((call) => call.path === "/api/chats/title/search").length, 0);
  const contentCall = calls.find((call) => call.path === "/api/chats/content/search");
  assert.equal(new Headers(contentCall.options.headers).get("x-tflash-owner-proof"), "proof-content");
  assert.equal(JSON.parse(contentCall.options.body).query, "needle");

  expired = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Message search complete.");
  assert.equal(screen.queryByText(/Some chats could not be searched/), null);
  assert.ok(screen.getByRole("link", { name: /API notes.*NEEDLE/ }));
  const previousCount = calls.filter((call) => call.path === "/api/chats/content/search").length;
  await user.click(screen.getByRole("button", { name: "Search again" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.path === "/api/chats/content/search").length, previousCount + 1));
  await screen.findByText("Message search complete.");
  await user.clear(search);
  assert.ok(screen.getByRole("link", { name: "Old chat" }));
  assert.equal(screen.queryByText("NEEDLE"), null);
});

test("message search debounces typing and ignores an older response even if fetch ignores abort", async () => {
  seed({ chats: [{ id: "chat", title: "Project", updatedAt: 1 }], chatProofs: { chat: "proof" } });
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const calls = fakeFetch((path, options) => {
    if (path !== "/api/chats/chat/search") return;
    const query = JSON.parse(options.body).query;
    if (query === "first") return first;
    if (query === "second") return Response.json({ status: "matched", snippet: { before: "new ", match: "second", after: " result" } });
    throw new Error(`Unexpected intermediate query: ${query}`);
  });
  render(app(h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} })));
  const user = userEvent.setup();
  const search = await screen.findByRole("searchbox", { name: "Search chats…" });
  await user.type(search, "first");
  await waitFor(() => assert.ok(calls.some((call) => call.path.endsWith("/search"))));
  const oldCall = calls.find((call) => call.path.endsWith("/search"));
  await user.clear(search);
  await user.type(search, "second");
  assert.equal(oldCall.options.signal.aborted, true);
  assert.ok(await screen.findByRole("link", { name: /Project.*second/ }));
  resolveFirst(Response.json({ status: "matched", snippet: { before: "stale ", match: "first", after: " result" } }));
  await waitFor(() => assert.ok(screen.getByRole("link", { name: /Project.*second/ })));
  assert.equal(screen.queryByText("first"), null);
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/search")).map((call) => JSON.parse(call.options.body).query), ["first", "second"]);
});

test("message search limits browser concurrency and does not announce no matches while work is pending", async () => {
  const chats = Array.from({ length: 5 }, (_, i) => ({ id: `chat-${i}`, title: `Chat ${i}`, updatedAt: i }));
  seed({ chats, chatProofs: Object.fromEntries(chats.map((chat) => [chat.id, `proof-${chat.id}`])) });
  const pending = [];
  const calls = fakeFetch((path) => {
    if (path.endsWith("/search")) return new Promise((resolve) => { pending.push(resolve); });
  });
  render(app(h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} })));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("searchbox", { name: "Search chats…" }), "absent");
  await waitFor(() => assert.equal(pending.length, 3));
  assert.equal(calls.filter((call) => call.path.endsWith("/search")).length, 3);
  assert.equal(screen.queryByText("No chats match your search."), null);
  pending[0](Response.json({ status: "no-match" }));
  await waitFor(() => assert.equal(pending.length, 4));
  pending[1](Response.json({ status: "no-match" }));
  await waitFor(() => assert.equal(pending.length, 5));
  for (let i = 2; i < pending.length; i++) pending[i](Response.json({ status: "no-match" }));
  assert.ok(await screen.findByText("No chats match your search."));
});

test("search is account-scoped on account change and Somali explains unavailable histories", async () => {
  seed({ language: "so", chats: [{ id: "alice-chat", title: "Alice only", updatedAt: 1 }], chatProofs: { "alice-chat": "alice-proof" } });
  window.localStorage.setItem("tflash:settings:v1:other-user", JSON.stringify({
    language: "so", chats: [{ id: "bob-chat", title: "Bob only", updatedAt: 1 }], chatProofs: { "bob-chat": "bob-proof" },
  }));
  let resolveOld;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const calls = fakeFetch((path) => {
    if (path === "/api/chats/alice-chat/search") return oldResponse;
    if (path === "/api/chats/bob-chat/search") return Response.json({ status: "unavailable" });
  });
  function ScopedApp() {
    const [id, setId] = React.useState(userId);
    return h(React.Fragment, null,
      h("button", { onClick: () => setId("other-user") }, "Switch account"),
      h(AppSettingsProvider, { key: `vercel:${id}`, userId: id, accountKind: "vercel" },
        h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} })),
    );
  }
  render(h(ScopedApp));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("searchbox", { name: "Raadi wada hadallo…" }), "needle");
  await waitFor(() => assert.ok(calls.some((call) => call.path === "/api/chats/alice-chat/search")));
  const oldCall = calls.find((call) => call.path === "/api/chats/alice-chat/search");
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  assert.equal(oldCall.options.signal.aborted, true);
  assert.ok(await screen.findByRole("link", { name: "Bob only" }));
  resolveOld(Response.json({ status: "matched", snippet: { before: "private ", match: "needle", after: " Alice" } }));
  await user.type(screen.getByRole("searchbox", { name: "Raadi wada hadallo…" }), "needle");
  assert.ok(await screen.findByText(/Qaar ka mid ah wada hadallada lama raadin karin/));
  assert.ok(screen.getByRole("button", { name: "Mar kale isku day" }));
  assert.equal(screen.queryByText(/private/), null);
  assert.equal(screen.queryByRole("link", { name: /Alice only/ }), null);
  assert.equal(screen.queryByText("Ma jiro wada hadal ku habboon raadinta."), null);
});


test("Supabase searches its account history without a browser ownership proof", async () => {
  seed();
  const calls = fakeFetch((path, options) => {
    if (path === "/api/chats") return Response.json({ chats: [{ id: "synced", title: "Synced title", updatedAt: 1 }], storage: "account" });
    if (path === "/api/chats/synced/search") {
      assert.equal(new Headers(options.headers).has("x-tflash-owner-proof"), false);
      return Response.json({ status: "matched", snippet: { before: "hello ", match: "needle", after: " again" } });
    }
  });
  render(app(h(Sidebar, { open: true, onClose() {}, onNewChat() {}, onOpenSettings() {} }), "supabase"));
  const user = userEvent.setup();
  const search = await screen.findByRole("searchbox", { name: "Search chats…" });
  await screen.findByRole("link", { name: "Synced title" });
  await user.type(search, "n");
  assert.ok(screen.getByText("Enter at least 2 characters to search messages."));
  assert.equal(calls.filter((call) => call.path.endsWith("/search")).length, 0);
  await user.type(search, "eedle");
  assert.ok(await screen.findByRole("link", { name: /Synced title.*needle/ }));
});

test("provisional tool output cannot produce a completed artifact card", async () => {
  const { AgentMessage } = await import("../components/chat/agent-message.tsx");
  seed(); fakeFetch();
  const output = { kind: "tflash-artifact", version: 1, artifact: { filename: "draft.txt", description: "Draft", content: "Provisional" } };
  const part = { type: "dynamic-tool", toolName: "create_artifact", toolCallId: "call-partial", state: "output-available", partial: true, input: {}, output };
  const props = { canRespond: () => false, isStreaming: true, onInputResponses() {}, questionsFor: () => [], message: { id: "assistant-partial", role: "assistant", parts: [part] } };
  render(app(h(AgentMessage, props)));
  assert.equal(screen.queryByRole("button", { name: "Download: draft.txt" }), null);
});

test("permissions panel loads, creates and revokes the limited grant", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx"); seed(); let grants=[];
  const calls=fakeFetch((path,options)=>{if(!path.endsWith("/permissions"))return;if(options.method==="POST")grants=[{origin:JSON.parse(options.body).origin,expiresAt:"2030-01-01T00:00:00Z",revision:"11111111-1111-4111-8111-111111111111"}];if(options.method==="DELETE")grants=[];return Response.json({grants, epoch:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"});});
  render(app(h(PermissionsPanel,{sessionId:"chat-a",ownerProof:"proof"})));const user=userEvent.setup();await user.click(screen.getByText("Permissions for this conversation"));await screen.findByText("No active reusable permissions.");await user.type(screen.getByLabelText("HTTPS homepage"),"https://example.com");await user.click(screen.getByRole("button",{name:"Allow homepage for one hour"}));await screen.findByText(/https:\/\/example.com/);assert.ok(calls.some(c=>c.options.method==="POST"&&c.options.headers["x-tflash-owner-proof"]==="proof"));await user.click(screen.getByRole("button",{name:"Revoke"}));await screen.findByText("No active reusable permissions.");
});

test("tracked task panel distinguishes missing evidence from cancellation", async () => {
  const {TrackedTaskPanel}=await import("../components/chat/tracked-task-panel.tsx");seed();let task={objective:"My objective",path:"out.txt",sha256:"a".repeat(64),revision:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",continuationBudget:0,state:"awaiting_evidence",verifiedAt:null,reason:null};fakeFetch((path,options)=>{if(!path.endsWith("/task"))return;if(options.method==="DELETE")task={...task,state:"cancelled"};return Response.json({task});});render(app(h(TrackedTaskPanel,{sessionId:"chat-a"})));const user=userEvent.setup();await user.click(screen.getByText("Track a file criterion"));await screen.findByText("Awaiting file evidence.");await user.click(screen.getByRole("button",{name:"Cancel tracking"}));await screen.findByText("Tracking cancelled.");assert.equal(screen.queryByText(/File criterion matched/),null);
});

test("collapsed activity panel does not scan streaming history until opened", async () => {
  const { ActivityPanel } = await import("../components/chat/activity-panel.tsx");
  seed(); fakeFetch();
  let scans = 0;
  const watch = (array) => new Proxy(array, { get(target, property, receiver) {
    if (property === Symbol.iterator) scans++;
    return Reflect.get(target, property, receiver);
  } });
  const messages = watch([{ role: "assistant", parts: [{ type: "dynamic-tool", toolName: "bash", toolCallId: "a", state: "output-available", output: { status: "completed", exitCode: 0 } }] }]);
  const events = watch([]);
  const rendered = render(app(h(ActivityPanel, { messages, events })));
  for (let i = 0; i < 20; i++) rendered.rerender(app(h(ActivityPanel, { messages, events })));
  assert.equal(scans, 0);
  await userEvent.setup().click(screen.getByText("Activity & usage"));
  await screen.findByText("Tool returned");
  assert.ok(scans > 0);
});

test("permission submissions are single-flight and aborted on unmount", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx");
  seed(); let release; let posts = 0; let signal;
  fakeFetch((path, options) => {
    if (!path.endsWith("/permissions")) return;
    if (options.method === "GET") return Response.json({ grants: [], epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    posts++; signal = options.signal;
    return new Promise((resolve) => { release = resolve; });
  });
  const rendered = render(app(h(PermissionsPanel, { sessionId: "chat-a" })));
  await userEvent.setup().click(screen.getByText("Permissions for this conversation"));
  await screen.findByText("No active reusable permissions.");
  const input = screen.getByLabelText("HTTPS homepage");
  fireEvent.change(input, { target: { value: "https://example.com" } });
  const form = input.closest("form");
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => assert.equal(posts, 1));
  rendered.unmount(); assert.equal(signal.aborted, true);
  release(Response.json({ grants: [], epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
});

test("a task revision conflict keeps the draft and requires refresh before replacement", async () => {
  const { TrackedTaskPanel } = await import("../components/chat/tracked-task-panel.tsx");
  seed(); let task = null;
  fakeFetch((path, options) => {
    if (!path.endsWith("/task")) return;
    if (options.method === "PUT") return Response.json({ error: "conflict", changeNotStarted: true }, { status: 409 });
    return Response.json({ task });
  });
  render(app(h(TrackedTaskPanel, { sessionId: "chat-a" })));
  const user = userEvent.setup();
  await user.click(screen.getByText("Track a file criterion"));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Save or replace tracked task" }).disabled, false));
  await user.type(screen.getByLabelText("Objective"), "My draft");
  await user.type(screen.getByLabelText("Workspace-relative file path"), "result.txt");
  await user.type(screen.getByLabelText("Expected SHA-256 (64 hexadecimal characters)"), "a".repeat(64));
  await user.click(screen.getByRole("button", { name: "Save or replace tracked task" }));
  await screen.findByText(/task changed elsewhere/i);
  assert.equal(screen.getByLabelText("Objective").value, "My draft");
  assert.equal(screen.getByRole("button", { name: "Save or replace tracked task" }).disabled, true);
  await user.click(screen.getByRole("button", { name: "Refresh task" }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Save or replace tracked task" }).disabled, false));
});

test("permission conflicts preserve the address and require refresh", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx");
  seed(); let attempts = 0;
  fakeFetch((path, options) => {
    if (!path.endsWith("/permissions")) return;
    if (options.method === "POST") { attempts++; return Response.json({ error: "conflict", changeNotStarted: true }, { status: 409 }); }
    return Response.json({ grants: [], epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });
  render(app(h(PermissionsPanel, { sessionId: "chat-a" })));
  const user = userEvent.setup();
  await user.click(screen.getByText("Permissions for this conversation"));
  await screen.findByText("No active reusable permissions.");
  const input = screen.getByLabelText("HTTPS homepage");
  await user.type(input, "https://example.com");
  await user.click(screen.getByRole("button", { name: "Allow homepage for one hour" }));
  await screen.findByText(/permissions changed elsewhere/i);
  assert.equal(input.value, "https://example.com"); assert.equal(attempts, 1);
  assert.equal(screen.getByRole("button", { name: "Allow homepage for one hour" }).disabled, true);
  await user.click(screen.getByRole("button", { name: "Refresh permissions" }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Allow homepage for one hour" }).disabled, false));
});

test("switching sessions aborts old panel loads and ignores late results", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx");
  seed(); let release, oldSignal;
  fakeFetch((path, options) => {
    if (!path.endsWith("/permissions")) return;
    if (path.includes("chat-a")) { oldSignal = options.signal; return new Promise(resolve => { release = resolve; }); }
    return Response.json({ epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", grants: [{ origin: "https://new.example", expiresAt: "2030-01-01T00:00:00Z", revision: "11111111-1111-4111-8111-111111111111" }] });
  });
  const rendered = render(app(h(PermissionsPanel, { sessionId: "chat-a" })));
  await userEvent.setup().click(screen.getByText("Permissions for this conversation"));
  await waitFor(() => assert.ok(oldSignal));
  rendered.rerender(app(h(PermissionsPanel, { sessionId: "chat-b" })));
  assert.equal(oldSignal.aborted, true);
  await screen.findByText(/https:\/\/new.example/);
  await React.act(async () => { release(Response.json({ epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", grants: [{ origin: "https://old.example", expiresAt: "2030-01-01T00:00:00Z", revision: "22222222-2222-4222-8222-222222222222" }] })); });
  assert.equal(screen.queryByText(/https:\/\/old.example/), null);
  assert.ok(screen.getByText(/https:\/\/new.example/));
});


test("revoke all remains available when the permission list fails", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx"); seed(); let revocations = 0;
  fakeFetch((path) => {
    if (path.endsWith("/permissions/revoke-all")) { revocations++; return Response.json({revoked:true}); }
    if (path.endsWith("/permissions")) return Response.json({error:"offline"}, {status:503});
  });
  render(app(h(PermissionsPanel, {sessionId:"chat-a", ownerProof:"proof"})));
  const user = userEvent.setup(); await user.click(screen.getByText("Permissions for this conversation"));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", {name:"Revoke all reusable permissions"}));
  await screen.findByText(/Reusable permissions revoked/); assert.equal(revocations, 1);
  assert.equal(screen.getByRole("button", {name:"Allow homepage for one hour"}).disabled, true);
});

test("emergency revocation interrupts a stuck list request and ignores its late response", async () => {
  const { PermissionsPanel } = await import("../components/chat/permissions-panel.tsx");
  seed(); let release, signal, allCalls = 0;
  fakeFetch((path, options) => {
    if (path.endsWith("/permissions/revoke-all")) { allCalls++; return Response.json({revoked:true}); }
    if (path.endsWith("/permissions")) { signal = options.signal; return new Promise(resolve => {release = resolve;}); }
  });
  render(app(h(PermissionsPanel, {sessionId:"chat-a"})));
  const user = userEvent.setup(); await user.click(screen.getByText("Permissions for this conversation"));
  await waitFor(() => assert.ok(signal));
  await user.click(screen.getByRole("button", {name:"Revoke all reusable permissions"}));
  assert.equal(signal.aborted,true); assert.equal(allCalls,1);
  await screen.findByText(/Reusable permissions revoked/);
  await React.act(async () => { release(Response.json({epoch:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",grants:[{origin:"https://old.example",expiresAt:"2030-01-01T00:00:00Z",revision:"11111111-1111-4111-8111-111111111111"}]})); });
  assert.equal(screen.queryByText(/https:\/\/old.example/),null);
});

test("budgeted continuation reserves and begins once, then requires a recorded human review", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  const calls=[]; let attempt=null, history=[], sends=0;
  fakeFetch((path, options) => {
    if (!path.endsWith('/task/continuations')) return;
    if (options.method==='GET') return Response.json({attempt,history});
    const input=JSON.parse(options.body); calls.push(input.action);
    if(input.action==='reserve') attempt={attemptId:input.attemptId,state:'reserved',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null};
    if(input.action==='begin') attempt={...attempt,state:'dispatching',reviewRevision:crypto.randomUUID()};
    if(input.action==='resolve') {history=[{attemptId:attempt.attemptId,reviewedAt:new Date().toISOString(),note:input.note}]; attempt=null;}
    return Response.json({ok:true});
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:2,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{calls.push('send');sends++;},onRefreshTask:()=>{}})));
  const user=userEvent.setup();
  const authorize=await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/});
  assert.equal(screen.getByRole('button',{name:'Start one budgeted turn'}).disabled,true);
  await user.click(authorize); await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await screen.findByText(/Dispatch began but the outcome is unknown/);
  assert.deepEqual(calls,['reserve','begin','send']); assert.equal(sends,1);
  assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
  await user.click(screen.getByRole('checkbox',{name:/I inspected the conversation/}));
  assert.equal(screen.getByRole('button',{name:'Confirm review and release hold'}).disabled,true);
  await user.type(screen.getByLabelText(/What did you check/),'Checked service; result remains unknown.');
  await user.click(screen.getByRole('button',{name:'Confirm review and release hold'}));
  await screen.findByText('Checked service; result remains unknown.');
  assert.deepEqual(calls,['reserve','begin','send','resolve']); assert.equal(sends,1);
});

test("an uncertain begin is never sent or retried automatically and survives a component reload", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let attempt=null, sends=0, begins=0;
  fakeFetch((path, options) => {
    if (!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return Response.json({attempt,history:[]});
    const input=JSON.parse(options.body);
    if(input.action==='reserve') { attempt={attemptId:input.attemptId,state:'reserved',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null}; return Response.json({ok:true}); }
    if(input.action==='begin') { begins++; attempt={...attempt,state:'dispatching',reviewRevision:crypto.randomUUID()}; return Response.json({error:'response lost'},{status:503}); }
    throw new Error('unexpected mutation');
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask:()=>{}};
  const rendered=render(app(h(TaskContinuation,props))); const user=userEvent.setup();
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize/}));
  await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await screen.findByText(/Dispatch began but the outcome is unknown/); assert.equal(sends,0); assert.equal(begins,1);
  rendered.unmount(); render(app(h(TaskContinuation,props)));
  await screen.findByText(/Dispatch began but the outcome is unknown/); assert.equal(sends,0); assert.equal(begins,1);
  assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
});

test("continuation does not send after cancellation while begin response is delayed", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let attempt=null, release, begins=0, sends=0;
  const delayed=new Promise(resolve=>{release=resolve;});
  fakeFetch((path, options) => {
    if(!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return Response.json({attempt,history:[]});
    const input=JSON.parse(options.body);
    if(input.action==='reserve') {attempt={attemptId:input.attemptId,state:'reserved',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null};return Response.json({ok:true});}
    if(input.action==='begin') {begins++;attempt={...attempt,state:'dispatching',reviewRevision:crypto.randomUUID()};return delayed;}
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask:()=>{}};
  const view=render(app(h(TaskContinuation,props))); const user=userEvent.setup();
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize/}));
  await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await waitFor(()=>assert.equal(begins,1));
  // Another part of the UI observes an active/stopped turn before the reply.
  view.rerender(app(h(TaskContinuation,{...props,disabled:true})));
  await React.act(async()=>release(Response.json({ok:true})));
  await screen.findByText(/Dispatch began but the outcome is unknown/); assert.equal(sends,0);
  assert.equal(screen.getByRole('button',{name:'Confirm review and release hold'}).disabled,true);
  view.unmount();
  assert.equal(sends,0); assert.equal(begins,1);
});

test("unresolved continuation can be held across reloads without releasing its web-approval fence", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let attempt={attemptId:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null}, history=[], sends=0;
  const calls=[];
  fakeFetch((path,options)=>{
    if(!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return Response.json({attempt,history});
    const data=JSON.parse(options.body); calls.push(data.action);
    assert.equal(data.expectedRevision,attempt.reviewRevision);
    if(data.action==='hold') attempt={...attempt,holdNote:data.note,holdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID()};
    else if(data.action==='resolve') {history=[{attemptId:attempt.attemptId,reviewedAt:new Date().toISOString(),note:data.note}]; attempt=null;}
    else throw new Error('unexpected action');
    return Response.json({ok:true});
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask:()=>{}};
  const view=render(app(h(TaskContinuation,props))); const user=userEvent.setup();
  await screen.findByText(/Dispatch began but the outcome is unknown/);
  await user.type(screen.getByLabelText(/What did you check/),'Remote service outcome is still uncertain.');
  await user.click(screen.getByRole('button',{name:'Save note and keep on hold'}));
  await screen.findByText(/Last unresolved note: Remote service outcome is still uncertain/);
  assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
  assert.equal(sends,0); assert.deepEqual(calls,['hold']);
  view.unmount(); render(app(h(TaskContinuation,props)));
  await screen.findByText(/Last unresolved note: Remote service outcome is still uncertain/);
  assert.equal(screen.getByRole('button',{name:'Confirm review and release hold'}).disabled,true);
  await user.type(screen.getByLabelText(/What did you check/),'Confirmed the prior turn stopped and checked the remote record.');
  await user.click(screen.getByRole('checkbox',{name:/I inspected the conversation/}));
  await user.click(screen.getByRole('button',{name:'Confirm review and release hold'}));
  await screen.findByText(/Confirmed the prior turn stopped/);
  assert.deepEqual(calls,['hold','resolve']); assert.equal(sends,0);
});

test("a late initial continuation read cannot overwrite a fresher manual refresh", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let release, reads=0;
  const old=new Promise(resolve=>{release=resolve;});
  const attempt={attemptId:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null};
  fakeFetch((path,options)=>{
    if(!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return ++reads===1 ? old : Response.json({attempt,history:[]});
    throw new Error('must not mutate');
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{throw new Error('must not send');},onRefreshTask:()=>{}})));
  const user=userEvent.setup();
  await user.click(screen.getByRole('button',{name:'Refresh continuation'}));
  await screen.findByText(/Dispatch began but the outcome is unknown/);
  await React.act(async()=>release(Response.json({attempt:null,history:[]})));
  assert.ok(screen.getByText(/Dispatch began but the outcome is unknown/));
  assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
});

test("unmount during delayed continuation begin never starts the agent", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let attempt=null, release, begun=false, sends=0;
  const blocked=new Promise(resolve=>{release=resolve;});
  fakeFetch(async(path,options)=>{
    if(!path.endsWith('/task/continuations')) return;
    if(options.method==='GET') return Response.json({attempt,history:[]});
    const input=JSON.parse(options.body);
    if(input.action==='reserve') {attempt={attemptId:input.attemptId,state:'reserved',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null}; return Response.json({ok:true});}
    if(input.action==='begin') {begun=true; await blocked; return Response.json({ok:true});}
    throw new Error('unexpected action');
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const view=render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask:()=>{}})));
  const user=userEvent.setup();
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));
  await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await waitFor(()=>assert.equal(begun,true)); view.unmount();
  await React.act(async()=>release()); assert.equal(sends,0);
});

test("continuation timeout stops waiting for a fetch that ignores its signal", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  const timeout=AbortSignal.timeout, deadline=new AbortController();
  AbortSignal.timeout=()=>deadline.signal;
  let release;
  try {
    const stalled=new Promise(resolve=>{release=resolve;});
    fakeFetch((path)=>path.endsWith('/task/continuations') ? stalled : undefined);
    const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
    render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask:()=>{}})));
    await React.act(async()=>deadline.abort());
    await screen.findByRole('alert');
    await React.act(async()=>release(Response.json({attempt:null,history:[]})));
    assert.ok(screen.getByRole('alert')); assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
  } finally { AbortSignal.timeout=timeout; }
});

test("changing continuation sessions clears busy and ignores an old mutation response", async () => {
  const { TaskContinuation } = await import("../components/chat/task-continuation.tsx"); seed();
  let release, requested=false;
  const stalled=new Promise(resolve=>{release=resolve;});
  const attempt={attemptId:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),reviewRevision:crypto.randomUUID(),holdNote:null,holdAt:null};
  fakeFetch((path,options)=>{
    if(!path.endsWith('/task/continuations')) return;
    if(path.includes('/chat-a/') && options.method==='POST') {requested=true; return stalled;}
    return Response.json({attempt:path.includes('/chat-a/') ? attempt : null,history:[]});
  });
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={task,disabled:false,onContinue:async()=>{throw new Error('must not send');},onRefreshTask:()=>{}};
  const view=render(app(h(TaskContinuation,{...props,sessionId:'chat-a'}))), user=userEvent.setup();
  await screen.findByText(/Dispatch began but the outcome is unknown/);
  await user.type(screen.getByLabelText(/What did you check/),'The remote effect is not yet clear.');
  await user.click(screen.getByRole('button',{name:'Save note and keep on hold'}));
  await waitFor(()=>assert.equal(requested,true));
  view.rerender(app(h(TaskContinuation,{...props,sessionId:'chat-b'})));
  await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/});
  assert.equal(screen.getByRole('button',{name:'Refresh continuation'}).disabled,false);
  await React.act(async()=>release(Response.json({ok:true})));
  assert.equal(screen.queryByText(/Dispatch began but the outcome is unknown/),null);
  assert.equal(screen.getByRole('button',{name:'Refresh continuation'}).disabled,false);
});

test("Vercel sync imports local proofs, loads another device's history, and keeps local data on failure", async () => {
  seed({chats:[{id:'local',title:'Local',updatedAt:1}],chatProofs:{local:'local-proof'}});
  let fail=false;
  const calls=fakeFetch((path,options)=>{
    if(path==='/api/chats') return fail ? Response.json({error:'offline'},{status:503}) : Response.json({storage:'account',chats:[]});
    if(path==='/api/chats/vercel-sync') {
      const body=JSON.parse(options.body);
      assert.equal(body.chats[0].proof,'local-proof');
      return Response.json({storage:'account',chats:[{id:'local',title:'Renamed remotely',updatedAt:2,proof:'local-proof'},{id:'remote',title:'Other device',updatedAt:3,proof:'remote-proof'}]});
    }
  });
  function Probe(){
    const {settings,refreshChats,historyError}=useAppSettings();
    return h('div',null,h('p',null,settings.chats.map(c=>c.title).join(',')),h('p',null,settings.chatProofs.remote ?? 'no remote proof'),h('p',null,historyError ?? 'no error'),h('button',{onClick:()=>void refreshChats()},'Refresh'));
  }
  render(app(h(Probe)));
  await screen.findByText('Renamed remotely,Other device');
  assert.ok(screen.getByText('remote-proof'));
  assert.ok(calls.some(c=>c.path==='/api/chats/vercel-sync'));
  await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).chatProofs.remote,'remote-proof'));
  fail=true;
  await userEvent.setup().click(screen.getByRole('button',{name:'Refresh'}));
  await screen.findByText('historyLoadFailed');
  assert.ok(screen.getByText('Renamed remotely,Other device'));
  assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).chats.length,2);
});

test("Vercel stale sync cannot undo a completed local rename", async () => {
  seed({chats:[{id:'local',title:'Old',updatedAt:1}],chatProofs:{local:'proof'}});
  let resolveImport;
  const pending=new Promise(resolve=>{resolveImport=resolve});
  fakeFetch((path,options)=>{
    if(path==='/api/chats') return Response.json({storage:'account',chats:[]});
    if(path==='/api/chats/vercel-sync') return pending;
    if(path==='/api/chats/local' && options.method==='PATCH') return Response.json({ok:true,title:'New'});
  });
  function Probe(){ const {settings,renameChat}=useAppSettings(); return h('div',null,h('p',null,settings.chats[0]?.title),h('button',{onClick:()=>void renameChat('local','New')},'Rename')); }
  render(app(h(Probe)));
  await screen.findByText('Old');
  await userEvent.setup().click(screen.getByRole('button',{name:'Rename'}));
  await screen.findByText('New');
  await React.act(async()=>{resolveImport(Response.json({storage:'account',chats:[{id:'local',title:'Old',updatedAt:1,proof:'proof'}]})); await pending;});
  assert.ok(screen.getByText('New'));
});

test("Vercel workspace sync migrates local projects and memory and loads them on another device", async () => {
  seed();
  const local={...emptyWorkspace(),memoryEnabled:true,maxSteps:7,projects:[{id:'p',name:'Device A project',instructions:'Careful instructions',chatIds:['chat']}],notes:[{id:'n',text:'A private note',enabled:true,projectId:'p'}]};
  const key=workspaceStorageKey('vercel',userId);
  window.localStorage.setItem(key,JSON.stringify(local));
  let remote=null, revision=null;
  const calls=fakeFetch((path,options)=>{
    if(path!== '/api/workspace') return;
    assert.equal(new Headers(options.headers).get('x-tflash-expected-user-id'),userId);
    if(options.method==='PUT') {
      const body=JSON.parse(options.body);
      assert.equal(body.expectedUpdatedAt,revision);
      remote=body.workspace; revision='2026-10-31T12:00:00.001Z';
      return Response.json({ok:true,storage:'cloud',updatedAt:revision});
    }
    return Response.json({storage:'cloud',workspace:remote,updatedAt:revision});
  });
  function Probe(){ const {workspace,syncStatus}=useWorkspace(); return h('div',null,h('p',null,workspace.projects[0]?.name ?? 'No project'),h('p',null,workspace.notes[0]?.text ?? 'No note'),h('p',{role:'status'},syncStatus)); }
  let view=render(app(h(Probe)));
  await waitFor(()=>assert.equal(screen.getByRole('status').textContent,'synced'));
  assert.deepEqual(remote,local);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,1);
  view.unmount(); window.localStorage.removeItem(key);
  view=render(app(h(Probe)));
  await screen.findByText('Device A project');
  assert.ok(screen.getByText('A private note'));
  await waitFor(()=>assert.equal(screen.getByRole('status').textContent,'synced'));
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)),local);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,1);
});

test("Vercel workspace sync retains divergent local and cloud copies for an explicit choice", async () => {
  seed();
  const local={...emptyWorkspace(),projects:[{id:'a',name:'Local project',instructions:'',chatIds:[]}]};
  const cloud={...emptyWorkspace(),projects:[{id:'b',name:'Cloud project',instructions:'',chatIds:[]}]};
  const key=workspaceStorageKey('vercel',userId); window.localStorage.setItem(key,JSON.stringify(local));
  const calls=fakeFetch((path,options)=>path==='/api/workspace' ? Response.json({storage:'cloud',workspace:cloud,updatedAt:'2026-10-31T12:00:00.000Z'}) : undefined);
  render(app(h(WorkspacePanel)));
  await screen.findByText('Local project');
  await screen.findByText("This device's copy is preserved. Keeping it replaces the cloud copy; using cloud replaces this device's copy.");
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)),local);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
  await userEvent.setup().click(screen.getByRole('button',{name:'Use cloud copy (replace this device)'}));
  await screen.findByText('Cloud project');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)),cloud);
});

test("Vercel edits during initial discovery do not write until remote conflict is checked", async () => {
  seed(); let resolveRemote;
  const remotePromise=new Promise(resolve=>{resolveRemote=resolve});
  const cloud={...emptyWorkspace(),maxSteps:19};
  const calls=fakeFetch((path)=>path==='/api/workspace' ? remotePromise : undefined);
  let store;
  function Probe(){store=useWorkspace(); return h('p',{role:'status'},store.syncStatus);}
  render(app(h(Probe)));
  await waitFor(()=>assert.equal(store.ready,true));
  await React.act(async()=>{store.change(w=>({...w,memoryEnabled:true}));});
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
  await React.act(async()=>{resolveRemote(Response.json({storage:'cloud',workspace:cloud,updatedAt:'2026-10-31T12:00:00.000Z'})); await remotePromise;});
  await waitFor(()=>assert.equal(store.syncStatus,'conflict'));
  assert.equal(store.workspace.memoryEnabled,true);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
});

test("Vercel sync failure keeps edits locally; retry detects a divergent cloud copy", async () => {
  seed(); let online=false;
  const cloud={...emptyWorkspace(),maxSteps:14};
  const calls=fakeFetch((path)=>path==='/api/workspace' ? online ? Response.json({storage:'cloud',workspace:cloud,updatedAt:'2026-10-31T12:00:00.000Z'}) : Response.json({error:'offline'},{status:503}) : undefined);
  render(app(h(WorkspacePanel)));
  await screen.findByRole('button',{name:'Retry workspace sync'});
  await userEvent.setup().click(screen.getByRole('checkbox',{name:'Use saved notes in future messages'}));
  const key=workspaceStorageKey('vercel',userId);
  assert.equal(JSON.parse(window.localStorage.getItem(key)).memoryEnabled,true);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
  online=true;
  await userEvent.setup().click(screen.getByRole('button',{name:'Retry workspace sync'}));
  await screen.findByText("This device's copy is preserved. Keeping it replaces the cloud copy; using cloud replaces this device's copy.");
  assert.equal(JSON.parse(window.localStorage.getItem(key)).memoryEnabled,true);
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
});

test("a newer local workspace edit is not replaced by a delayed cloud conflict choice", async () => {
  seed();
  const local={...emptyWorkspace(),maxSteps:2}; const cloud={...emptyWorkspace(),maxSteps:3};
  window.localStorage.setItem(workspaceStorageKey('vercel',userId),JSON.stringify(local));
  let calls=0, resolveReview;
  const pending=new Promise(resolve=>{resolveReview=resolve});
  fakeFetch((path)=>{ if(path==='/api/workspace') return ++calls===1 ? Response.json({storage:'cloud',workspace:cloud,updatedAt:'2026-10-31T12:00:00.000Z'}) : pending; });
  let store;
  function Probe(){store=useWorkspace();return h('p',{role:'status'},store.syncStatus);}
  render(app(h(Probe)));
  await waitFor(()=>assert.equal(store.syncStatus,'conflict'));
  let review;
  await React.act(async()=>{review=store.resolveConflict('cloud');});
  await React.act(async()=>{store.change(w=>({...w,memoryEnabled:true}));});
  await React.act(async()=>{resolveReview(Response.json({storage:'cloud',workspace:cloud,updatedAt:'2026-10-31T12:00:00.000Z'})); await review;});
  assert.equal(store.syncStatus,'conflict');
  assert.equal(store.workspace.memoryEnabled,true);
  assert.equal(store.workspace.maxSteps,2);
});

test("corrupt browser workspace is not overwritten by a valid Vercel cloud snapshot", async () => {
  seed(); const key=workspaceStorageKey('vercel',userId); window.localStorage.setItem(key,'broken-json');
  const calls=fakeFetch(path=>path==='/api/workspace'?Response.json({storage:'cloud',workspace:emptyWorkspace(),updatedAt:'2026-10-31T12:00:00.000Z'}):undefined);
  let store; function Probe(){store=useWorkspace(); return h('p',{role:'status'},store.syncStatus);}
  render(app(h(Probe)));
  await waitFor(()=>assert.equal(store.syncStatus,'error'));
  assert.equal(store.storageError,true); assert.equal(window.localStorage.getItem(key),'broken-json');
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
});

test("Vercel workspace response lost after a write requires review without replay", async () => {
  seed(); let remote=null, revision=null, writes=0;
  const calls=fakeFetch((path,options)=>{
    if(path!=='/api/workspace') return;
    if(options.method==='PUT') {
      writes++; const body=JSON.parse(options.body); remote=body.workspace; revision='2026-10-31T12:00:00.001Z';
      return Response.json({error:'lost response'},{status:503});
    }
    return Response.json({storage:'cloud',workspace:remote,updatedAt:revision});
  });
  render(app(h(WorkspacePanel)));
  await screen.findByRole('button',{name:'Retry workspace sync'});
  assert.equal(writes,1);
  await userEvent.setup().click(screen.getByRole('button',{name:'Retry workspace sync'}));
  await screen.findByText(/An earlier save may have reached the cloud/, { selector: '[role="alert"]' });
  assert.equal(writes,1);
  await userEvent.setup().click(screen.getByRole('button',{name:'Use cloud copy (replace this device)'}));
  await waitFor(()=>assert.equal(screen.getByRole('status').textContent,'Workspace synced to your signed-in account. Memory remains opt-in; avoid storing secrets.'));
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,1);
});

test("empty malformed Vercel local workspace cannot overwrite a valid cloud copy", async () => {
  seed(); const key=workspaceStorageKey('vercel',userId); window.localStorage.setItem(key,'');
  const calls=fakeFetch(path=>path==='/api/workspace'?Response.json({storage:'cloud',workspace:emptyWorkspace(),updatedAt:'2026-10-31T12:00:00.000Z'}):undefined);
  let store; function Probe(){store=useWorkspace(); return h('p',{role:'status'},store.syncStatus);}
  render(app(h(Probe)));
  await waitFor(()=>assert.equal(store.syncStatus,'error'));
  assert.equal(store.storageError,true); assert.equal(window.localStorage.getItem(key),'');
  assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
  assert.throws(()=>store.change(w=>({...w,memoryEnabled:true})));
});

test("late Vercel workspace load cannot leak across an account switch", async () => {
  seed(); let resolveAlice;
  const aliceResponse=new Promise(resolve=>{resolveAlice=resolve});
  const alice={...emptyWorkspace(),notes:[{id:'a',text:'Alice private note',projectId:null,enabled:true}]};
  const bob={...emptyWorkspace(),notes:[{id:'b',text:'Bob private note',projectId:null,enabled:true}]};
  fakeFetch((path,options)=>{
    if(path!=='/api/workspace') return;
    const id=new Headers(options.headers).get('x-tflash-expected-user-id');
    return id==='alice' ? aliceResponse : Response.json({storage:'cloud',workspace:bob,updatedAt:'2026-10-31T12:00:00.000Z'});
  });
  function Probe(){const {workspace}=useWorkspace();return h('p',null,workspace.notes[0]?.text ?? 'Loading');}
  const view=render(h(WorkspaceProvider,{kind:'vercel',userId:'alice'},h(Probe)));
  await screen.findByText('Loading');
  view.rerender(h(WorkspaceProvider,{kind:'vercel',userId:'bob'},h(Probe)));
  await screen.findByText('Bob private note');
  await React.act(async()=>{resolveAlice(Response.json({storage:'cloud',workspace:alice,updatedAt:'2026-10-31T12:00:00.000Z'})); await aliceResponse;});
  assert.ok(screen.getByText('Bob private note'));
  assert.equal(screen.queryByText('Alice private note'),null);
  assert.equal(window.localStorage.getItem(workspaceStorageKey('vercel','alice')),null);
});

test("collapsed shell tool labels show failed, partial and unknown outcomes without opening outputs", async () => {
  const { AgentMessage } = await import("../components/chat/agent-message.tsx");
  seed(); fakeFetch();
  const part=(id,output,partial=false)=>({type:'dynamic-tool',toolName:'bash',toolCallId:id,state:'output-available',input:{command:`secret-${id}`},output,partial});
  const parts=[part('failed',{status:'completed',exitCode:2}),part('background',{status:'running',pid:123}),part('unknown',{}),part('partial',{status:'completed',exitCode:1},true),part('success',{status:'completed',exitCode:0})];
  const message={id:'shell-test',role:'assistant',parts};
  render(app(h(AgentMessage,{message,isStreaming:false,canRespond:()=>false,questionsFor:()=>[],onInputResponses(){}})));
  const headers=screen.getAllByRole('button',{name:/bash/});
  assert.equal(headers.length,5);
  assert.match(headers[0].textContent,/Failed/);
  assert.match(headers[1].textContent,/Started · outcome unknown/);
  assert.match(headers[2].textContent,/Outcome unknown/);
  assert.match(headers[3].textContent,/Running/);
  assert.doesNotMatch(headers[4].textContent,/Failed|unknown|Running/);
  assert.equal(screen.queryByText(/secret-failed/),null);
  await userEvent.setup().click(headers[0]);
  assert.ok(await screen.findByText(/Exited with code 2/));
});

test("shell status labels are translated in Somali", async () => {
  const { AgentMessage } = await import("../components/chat/agent-message.tsx");
  seed({language:'so'}); fakeFetch();
  const message={id:'shell-so',role:'assistant',parts:[{type:'dynamic-tool',toolName:'bash',toolCallId:'failure',state:'output-available',input:{command:'x'},output:{status:'completed',exitCode:1}}]};
  render(app(h(AgentMessage,{message,isStreaming:false,canRespond:()=>false,questionsFor:()=>[],onInputResponses(){}})));
  assert.match((await screen.findByRole('button',{name:/bash/})).textContent,/Fashilantay/);
});

test("reported usage panel is lazy, localized, and updates as the event snapshot changes", async () => {
  const { UsagePanel }=await import('../components/chat/usage-panel.tsx');
  seed({language:'so'}); fakeFetch();
  let scans=0;
  const watch=items=>new Proxy(items,{get(target,key,receiver){if(key===Symbol.iterator) scans++; return Reflect.get(target,key,receiver);}});
  const initial=watch([{type:'session.waiting',data:{usage:{inputTokens:100,outputTokens:20,costUsd:0.1}}}]);
  const view=render(app(h(UsagePanel,{events:initial})));
  for(let i=0;i<5;i++) view.rerender(app(h(UsagePanel,{events:initial})));
  assert.equal(scans,0);
  await userEvent.setup().click(await screen.findByText('Isticmaalka model-ka ee la soo sheegay'));
  assert.ok(await screen.findByText('100'));
  assert.ok(screen.getByText('$0.1000'));
  assert.ok(scans>0);
  const changed=watch([{type:'session.waiting',data:{usage:{inputTokens:110}}}]);
  view.rerender(app(h(UsagePanel,{events:changed})));
  assert.ok(await screen.findByText('110'));
  assert.equal(screen.queryByText('$0.1000'),null);
  assert.equal(screen.getAllByText('Lama soo sheegin').length,2);
});

test("clear search restores the chat list, returns focus, and discards late results", async () => {
  seed({chats:[{id:'chat',title:'Project',updatedAt:1}],chatProofs:{chat:'proof'}});
  let resolveSearch;
  const pending=new Promise(resolve=>{resolveSearch=resolve});
  const calls=fakeFetch(path=>path==='/api/chats/chat/search'?pending:undefined);
  render(app(h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}})));
  const user=userEvent.setup();
  const input=await screen.findByRole('searchbox',{name:'Search chats…'});
  await user.type(input,'needle');
  await waitFor(()=>assert.ok(calls.some(call=>call.path==='/api/chats/chat/search')));
  const request=calls.find(call=>call.path==='/api/chats/chat/search');
  await user.click(screen.getByRole('button',{name:'Clear chat search'}));
  assert.equal(input.value,''); assert.equal(document.activeElement,input);
  assert.equal(request.options.signal.aborted,true);
  assert.ok(screen.getByRole('link',{name:'Project'}));
  await React.act(async()=>{resolveSearch(Response.json({status:'matched',snippet:{before:'',match:'needle',after:''}}));await pending;});
  assert.equal(screen.queryByText('needle'),null);
  assert.equal(screen.queryByRole('button',{name:'Clear chat search'}),null);
});

test("a search transport that ignores abort times out without blocking remaining chats", async () => {
  const chats=Array.from({length:4},(_,i)=>({id:`s${i}`,title:`Project ${i}`,updatedAt:i}));
  seed({chats,chatProofs:Object.fromEntries(chats.map(c=>[c.id,'proof']))});
  const oldTimeout=window.setTimeout;
  window.setTimeout=function(fn,delay,...args){return oldTimeout.call(window,fn,delay===16000?40:delay,...args);};
  const calls=fakeFetch(path=>path.endsWith('/search') ? path.includes('/s3/') ? Response.json({status:'no-match'}) : new Promise(()=>{}) : undefined);
  try {
    render(app(h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}})));
    await userEvent.setup().type(await screen.findByRole('searchbox',{name:'Search chats…'}),'needle');
    await screen.findByText(/Some chats could not be searched/);
    assert.equal(calls.filter(call=>call.path.endsWith('/search')).length,4);
    assert.equal(screen.queryByText('No chats match your search.'),null);
    assert.ok(screen.getByRole('button',{name:'Try again'}));
  } finally {window.setTimeout=oldTimeout;}
});

test("Somali chat search has a translated clear control", async () => {
  seed({language:'so',chats:[{id:'chat',title:'Project',updatedAt:1}],chatProofs:{chat:'proof'}}); fakeFetch();
  render(app(h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}})));
  const user=userEvent.setup(); const input=await screen.findByRole('searchbox',{name:'Raadi wada hadallo…'});
  await user.type(input,'x');
  await user.click(screen.getByRole('button',{name:'Nadiifi raadinta wada hadallada'}));
  assert.equal(input.value,''); assert.equal(document.activeElement,input);
});

test("a search response with a stalled JSON body is marked incomplete rather than hanging", async () => {
  seed({chats:[{id:'json',title:'Project',updatedAt:1}],chatProofs:{json:'proof'}});
  const oldTimeout=window.setTimeout;
  window.setTimeout=function(fn,delay,...args){return oldTimeout.call(window,fn,delay===16000?40:delay,...args);};
  fakeFetch(path=>path==='/api/chats/json/search'?{ok:true,json:()=>new Promise(()=>{})}:undefined);
  try {
    render(app(h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}})));
    await userEvent.setup().type(await screen.findByRole('searchbox',{name:'Search chats…'}),'needle');
    assert.ok(await screen.findByText(/Some chats could not be searched/));
    assert.equal(screen.queryByText('No chats match your search.'),null);
  } finally {window.setTimeout=oldTimeout;}
});

test("workspace timed-out write holds queued edits until an explicit cloud review", async () => {
  seed(); const originalTimeout=AbortSignal.timeout; const deadlines=[];
  AbortSignal.timeout=()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;};
  let releaseFirst, firstSignal, writes=0, remote=null, revision=null;
  const pending=new Promise(resolve=>{releaseFirst=resolve;});
  const calls=fakeFetch((path,options)=>{
    if(path!=='/api/workspace')return;
    if(options.method==='PUT') {
      writes++;
      if(writes===1){firstSignal=options.signal;return pending;}
      const body=JSON.parse(options.body); assert.equal(body.expectedUpdatedAt,revision);
      remote=body.workspace;revision='2026-10-31T13:00:00.001Z';
      return Response.json({ok:true,storage:'cloud',updatedAt:revision});
    }
    return Response.json({storage:'cloud',workspace:remote,updatedAt:revision});
  });
  let store;
  function Probe(){store=useWorkspace();return h('div',null,h('p',{role:'status'},store.syncStatus),h('button',{onClick:store.retrySync},'Retry'),h('button',{onClick:()=>void store.resolveConflict('browser')},'Keep local'));}
  try {
    render(app(h(Probe)));
    await waitFor(()=>assert.equal(writes,1));
    await React.act(async()=>{store.change(w=>({...w,memoryEnabled:true}));store.change(w=>({...w,maxSteps:5}));});
    const deadline=deadlines.find(c=>c.signal===firstSignal);assert.ok(deadline);
    await React.act(async()=>{deadline.abort();});
    await waitFor(()=>assert.equal(store.syncStatus,'error'));
    assert.equal(writes,1);assert.equal(store.workspace.maxSteps,5);
    assert.equal(JSON.parse(window.localStorage.getItem(workspaceStorageKey('vercel',userId))).memoryEnabled,true);
    await React.act(async()=>{releaseFirst(Response.json({ok:true,storage:'cloud',updatedAt:'2026-10-31T13:00:00.000Z'}));await pending;});
    await userEvent.setup().click(screen.getByRole('button',{name:'Retry'}));
    await waitFor(()=>assert.equal(store.syncStatus,'uncertain'));
    assert.equal(writes,1,'review read must not automatically replay the write');
    await userEvent.setup().click(screen.getByRole('button',{name:'Keep local'}));
    await waitFor(()=>assert.equal(store.syncStatus,'synced'));
    assert.equal(writes,2); assert.equal(remote.maxSteps,5); assert.equal(remote.memoryEnabled,true);
    assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,2);
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("workspace load timeout leaves local data untouched and offers manual retry", async () => {
  seed(); const originalTimeout=AbortSignal.timeout; const deadlines=[];
  AbortSignal.timeout=()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;};
  const local={...emptyWorkspace(),maxSteps:9};const key=workspaceStorageKey('vercel',userId);
  window.localStorage.setItem(key,JSON.stringify(local));
  let requestSignal; const calls=fakeFetch((path,options)=>{if(path==='/api/workspace'){requestSignal=options.signal;return new Promise(()=>{});}});
  let store;function Probe(){store=useWorkspace();return h('p',{role:'status'},store.syncStatus);}
  try {
    render(app(h(Probe)));
    await waitFor(()=>assert.ok(requestSignal));
    await React.act(async()=>{deadlines.find(c=>c.signal===requestSignal).abort();});
    await waitFor(()=>assert.equal(store.syncStatus,'error'));
    assert.deepEqual(JSON.parse(window.localStorage.getItem(key)),local);
    assert.equal(calls.filter(c=>c.path==='/api/workspace'&&c.options.method==='PUT').length,0);
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("uncertain Vercel history import is not retried on focus; explicit refresh can retry", async () => {
  seed({chats:[{id:'local',title:'Local',updatedAt:1}],chatProofs:{local:'proof'}});
  const originalTimeout=AbortSignal.timeout; const deadlines=[];
  AbortSignal.timeout=()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;};
  let importSignal,posts=0;
  const calls=fakeFetch((path,options)=>{
    if(path==='/api/chats') {
      const h=new Headers(options.headers);assert.equal(h.get('x-tflash-expected-user-id'),userId);assert.equal(h.get('x-tflash-expected-account-kind'),'vercel');
      return Response.json({storage:'account',chats:[]});
    }
    if(path==='/api/chats/vercel-sync') {
      posts++;const h=new Headers(options.headers);assert.equal(h.get('x-tflash-expected-user-id'),userId);
      if(posts===1){importSignal=options.signal;return new Promise(()=>{});}
      return Response.json({storage:'account',chats:[{id:'local',title:'Local',updatedAt:1,proof:'proof'}]});
    }
  });
  function Probe(){const {settings,historyError,refreshChats}=useAppSettings();return h('div',null,h('p',null,historyError??'no error'),h('p',null,settings.chats[0]?.title??'none'),h('button',{onClick:()=>void refreshChats()},'Refresh'));}
  try {
    render(app(h(Probe)));
    await waitFor(()=>assert.ok(importSignal));
    await React.act(async()=>window.dispatchEvent(new Event('focus')));
    assert.equal(posts,1,'focus cannot start a second concurrent import');
    await React.act(async()=>{deadlines.find(c=>c.signal===importSignal).abort();});
    await screen.findByText('historyImportUncertain');
    const getCount=calls.filter(c=>c.path==='/api/chats').length;
    await React.act(async()=>window.dispatchEvent(new Event('focus')));
    assert.equal(posts,1);assert.equal(calls.filter(c=>c.path==='/api/chats').length,getCount);
    assert.ok(screen.getByText('Local'));
    await userEvent.setup().click(screen.getByRole('button',{name:'Refresh'}));
    await waitFor(()=>assert.equal(posts,2));
    await screen.findByText('no error');
    assert.ok(screen.getByText('Local'));
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("workspace write with stalled response JSON is treated as uncertain", async () => {
  seed();const originalTimeout=AbortSignal.timeout;const deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,writes=0;
  fakeFetch((path,options)=>{
    if(path!=='/api/workspace')return;
    if(options.method!=='PUT')return Response.json({storage:'cloud',workspace:null,updatedAt:null});
    writes++;signal=options.signal;
    const response=Response.json({ok:true});response.json=()=>new Promise(()=>{});return response;
  });
  let store;function Probe(){store=useWorkspace();return h('button',{onClick:store.retrySync},'Retry');}
  try {
    render(app(h(Probe)));
    await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await waitFor(()=>assert.equal(store.syncStatus,'error'));
    await userEvent.setup().click(screen.getByRole('button',{name:'Retry'}));
    await waitFor(()=>assert.equal(store.syncStatus,'uncertain'));
    assert.equal(writes,1);
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("stalled history read preserves local chats and can retry on focus", async () => {
  seed({chats:[{id:'local',title:'Local',updatedAt:1}],chatProofs:{local:'proof'}});
  const originalTimeout=AbortSignal.timeout;const deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,reads=0;
  fakeFetch((path,options)=>{
    if(path==='/api/chats'){
      reads++;if(reads===1){signal=options.signal;return new Promise(()=>{});}
      return Response.json({storage:'account',chats:[{id:'local',title:'Local',updatedAt:1,proof:'proof'}]});
    }
    if(path==='/api/chats/vercel-sync')return Response.json({storage:'account',chats:[{id:'local',title:'Local',updatedAt:1,proof:'proof'}]});
  });
  function Probe(){const {settings,historyError}=useAppSettings();return h('div',null,h('span',null,settings.chats[0]?.title??'none'),h('span',null,historyError??'ok'));}
  try {
    render(app(h(Probe)));await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await screen.findByText('historyLoadFailed');assert.ok(screen.getByText('Local'));
    await React.act(async()=>window.dispatchEvent(new Event('focus')));
    await waitFor(()=>assert.equal(reads,2));await screen.findByText('ok');assert.ok(screen.getByText('Local'));
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("uncertain workspace marker survives remount and requires an explicit choice", async () => {
  seed(); const originalTimeout=AbortSignal.timeout, deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let writes=0,signal;
  fakeFetch((path,options)=>{if(path!=='/api/workspace')return;if(options.method==='PUT'){writes++;signal=options.signal;return new Promise(()=>{});}return Response.json({storage:'cloud',workspace:null,updatedAt:null});});
  let store; function Probe(){store=useWorkspace();return h('button',{onClick:()=>void store.resolveConflict('cloud')},'Use cloud');}
  const element=()=>app(h(Probe));
  try {
    const mounted=render(element());await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await waitFor(()=>assert.equal(store.syncStatus,'error'));
    assert.ok(Object.keys(window.localStorage).some(k=>k.startsWith('tflash:sync-uncertain:workspace:')));
    mounted.unmount();render(element());await waitFor(()=>assert.equal(store.syncStatus,'uncertain'));
    assert.equal(writes,1);await userEvent.setup().click(screen.getByRole('button',{name:'Use cloud'}));
    await waitFor(()=>assert.equal(store.syncStatus,'synced'));
    assert.equal(Object.keys(window.localStorage).filter(k=>k.startsWith('tflash:sync-uncertain:workspace:')).length,0);
    assert.equal(writes,1);
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("uncertain history import survives remount and never imports automatically", async () => {
  seed({chats:[{id:'local',title:'Local',updatedAt:1}],chatProofs:{local:'proof'}});
  const originalTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,posts=0,reads=0;
  fakeFetch((path,options)=>{
    if(path==='/api/chats'){reads++;return Response.json({storage:'account',chats:[]});}
    if(path==='/api/chats/vercel-sync'){posts++;if(posts===1){signal=options.signal;return new Promise(()=>{});}return Response.json({storage:'account',chats:[{id:'local',title:'Local',updatedAt:1,proof:'proof'}]});}
  });
  function Probe(){const {historyError,refreshChats}=useAppSettings();return h('div',null,h('p',null,historyError??'ok'),h('button',{onClick:()=>void refreshChats()},'Refresh'));}
  try {
    const mounted=render(app(h(Probe)));await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await screen.findByText('historyImportUncertain');const previousReads=reads;
    mounted.unmount();render(app(h(Probe)));await screen.findByText('historyImportUncertain');
    assert.equal(posts,1);assert.equal(reads,previousReads);
    await userEvent.setup().click(screen.getByRole('button',{name:'Refresh'}));
    await waitFor(()=>assert.equal(posts,2));await screen.findByText('ok');
    assert.equal(Object.keys(window.localStorage).filter(k=>k.startsWith('tflash:sync-uncertain:history:')).length,0);
  } finally {AbortSignal.timeout=originalTimeout;}
});

test("cloud mutations fail closed if durable uncertainty markers cannot be written", async () => {
  seed({chats:[{id:'local',title:'Local',updatedAt:1}],chatProofs:{local:'proof'}});
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.startsWith('tflash:sync-uncertain:'))throw new Error('storage denied');return original.call(this,key,value);};
  let workspacePuts=0,historyPosts=0;
  fakeFetch((path,options)=>{
    if(path==='/api/workspace'){if(options.method==='PUT'){workspacePuts++;}return Response.json({storage:'cloud',workspace:null,updatedAt:null});}
    if(path==='/api/chats')return Response.json({storage:'account',chats:[]});
    if(path==='/api/chats/vercel-sync'){historyPosts++;return Response.json({storage:'account',chats:[]});}
  });
  let store;function Probe(){store=useWorkspace();const {historyError}=useAppSettings();return h('p',null,historyError??'ok');}
  try {
    render(app(h(Probe)));
    await screen.findByText('historyImportUncertain');await waitFor(()=>assert.equal(store.syncStatus,'error'));
    assert.equal(workspacePuts,0);assert.equal(historyPosts,0);
  } finally {proto.setItem=original;}
});

test("workspace review does not clear a marker created by another operation during its read", async () => {
  seed();const old='tflash:sync-uncertain:workspace:vercel:ui-test:old';const newer='tflash:sync-uncertain:workspace:vercel:ui-test:new';
  window.localStorage.setItem(old,'1');let reads=0,release;const pending=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path!=='/api/workspace')return;assert.notEqual(options.method,'PUT');reads++;if(reads===2)return pending;return Response.json({storage:'cloud',workspace:null,updatedAt:null});});
  let store;function Probe(){store=useWorkspace();return h('button',{onClick:()=>void store.resolveConflict('cloud')},'Use cloud');}
  render(app(h(Probe)));
  await waitFor(()=>assert.equal(store.syncStatus,'uncertain'));
  await userEvent.setup().click(screen.getByRole('button',{name:'Use cloud'}));await waitFor(()=>assert.equal(reads,2));
  window.localStorage.setItem(newer,'1');
  await React.act(async()=>{release(Response.json({storage:'cloud',workspace:null,updatedAt:null}));await pending;});
  await waitFor(()=>assert.equal(store.syncStatus,'uncertain'));
  assert.equal(window.localStorage.getItem(old),null);assert.equal(window.localStorage.getItem(newer),'1');
});

test("uncertain chat removal survives remount, blocks replay, and requires an explicit reviewed acknowledgment", async () => {
  seed({ chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof'} });
  const oldTimeout=AbortSignal.timeout, deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,release,removals=0;const pending=new Promise(r=>{release=r;});
  const calls=fakeFetch((path,options)=>{
    if(path==='/api/chats/chat-a' && options.method==='DELETE'){
      removals++;const headers=new Headers(options.headers);assert.equal(headers.get('x-tflash-expected-user-id'),userId);assert.equal(headers.get('x-tflash-expected-account-kind'),'vercel');
      if(removals===1){signal=options.signal;return pending;}return Response.json({ok:true});
    }
  });
  let actions;function Probe(){actions=useAppSettings();return h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}});}
  try {
    const mounted=render(app(h(Probe)));await screen.findByRole('link',{name:'Original'});
    let first,queued;await React.act(async()=>{first=actions.removeChat('chat-a').catch(e=>e);queued=actions.renameChat('chat-a','New').catch(e=>e);});
    await waitFor(()=>assert.ok(signal));await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    const [failure,queuedFailure]=await Promise.all([first,queued]);assert.equal(failure.name,'ChatActionUncertainError');assert.equal(queuedFailure.name,'ChatActionUncertainError');
    assert.equal(removals,1);assert.equal(calls.filter(c=>c.path==='/api/chats/chat-a'&&c.options.method==='PATCH').length,0);
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).chats[0].title,'Original');
    await React.act(async()=>{release(Response.json({ok:true}));await pending;});
    mounted.unmount();render(app(h(Probe)));
    const warning=await screen.findByText(/A chat action may have completed or may still finish/);
    assert.ok(warning);assert.equal(removals,1);
    const check=screen.getByRole('checkbox',{name:/I inspected the history/});const review=screen.getByRole('button',{name:'Acknowledge and allow new actions'});
    assert.equal(review.disabled,true);const user=userEvent.setup();await user.click(check);await user.click(review);
    assert.equal(screen.queryByText(/A chat action may have completed or may still finish/),null);
    assert.equal(removals,1,'acknowledgment never repeats the action');
    await React.act(async()=>{await actions.removeChat('chat-a');});assert.equal(removals,2);
  } finally {AbortSignal.timeout=oldTimeout;}
});

test("stalled chat response JSON holds only that conversation and preserves local data", async () => {
  seed({chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof','chat-b':'proof'}});
  const oldTimeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,writes=0;fakeFetch((path,options)=>{
    if(path==='/api/chats/chat-a'&&options.method==='PATCH') {writes++;signal=options.signal;const res=Response.json({ok:true});res.json=()=>new Promise(()=>{});return res;}
    if(path==='/api/chats/chat-b'&&options.method==='PATCH')return Response.json({ok:true,title:'Other'});
  });
  let actions;function Probe(){actions=useAppSettings();return h('p',null,actions.settings.chats[0]?.title??'none');}
  try {
    render(app(h(Probe)));await screen.findByText('Original');let failure;
    await React.act(async()=>{failure=actions.renameChat('chat-a','New').catch(e=>e);});
    await waitFor(()=>assert.ok(signal));await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    assert.equal((await failure).name,'ChatActionUncertainError');
    await React.act(async()=>{await actions.recordChatActivity('chat-a','Original').catch(()=>{});await actions.renameChat('chat-b','Other');});
    assert.equal(writes,1);assert.ok(actions.settings.chats.find(c=>c.id==='chat-a'&&c.title==='Original'));assert.equal(actions.settings.chats[0].title,'Other');
  } finally {AbortSignal.timeout=oldTimeout;}
});

test("chat actions fail closed when recovery markers cannot be written", async () => {
  seed({chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof'}});
  const proto=Object.getPrototypeOf(window.localStorage), original=proto.setItem;
  proto.setItem=function(k,v){if(k.startsWith('tflash:sync-uncertain:chat-action:'))throw new Error('blocked');return original.call(this,k,v);};
  let calls=0;fakeFetch((path,options)=>{if(path==='/api/chats/chat-a'&&options.method==='PATCH'){calls++;return Response.json({ok:true});}});
  let actions;function Probe(){actions=useAppSettings();return h('p',null,actions.chatActionStorageError?'storage blocked':'ready');}
  try {render(app(h(Probe)));await screen.findByText('ready');await React.act(async()=>{await actions.renameChat('chat-a','New').catch(()=>{});});await screen.findByText('storage blocked');assert.equal(calls,0);}
  finally {proto.setItem=original;}
});

test("history action warnings are account-scoped and malformed markers block conservatively", async () => {
  seed({chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof'}});
  const base='tflash:sync-uncertain:chat-action:vercel:';
  window.localStorage.setItem(`${base}other-user:one`,JSON.stringify({chatId:'chat-a',action:'remove'}));
  window.localStorage.setItem(`${base}${encodeURIComponent(userId)}:bad`,'not-json');
  let mutations=0;fakeFetch((path,options)=>{if(path==='/api/chats/chat-a'&&options.method==='PATCH'){mutations++;return Response.json({ok:true});}});
  let actions;function Probe(){actions=useAppSettings();return h('p',null,String(actions.chatActionWarnings.length));}
  render(app(h(Probe)));await screen.findByText('1');
  let error;await React.act(async()=>{error=await actions.renameChat('chat-a','New').catch(e=>e);});
  assert.equal(error.name,'ChatActionUncertainError');assert.equal(mutations,0);
  await React.act(async()=>actions.acknowledgeChatAction(actions.chatActionWarnings[0].key));
  await React.act(async()=>actions.renameChat('chat-a','New'));
  assert.equal(mutations,1);assert.ok(window.localStorage.getItem(`${base}other-user:one`));
});

test("a non-successful chat action response that could follow a partial write requires review", async () => {
  seed({chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof'}});
  let writes=0;fakeFetch((path,options)=>{if(path==='/api/chats/chat-a'&&options.method==='PATCH'){writes++;return Response.json({error:'not found'},{status:404});}});
  let actions;function Probe(){actions=useAppSettings();return h('p',null,String(actions.chatActionWarnings.length));}
  render(app(h(Probe)));await screen.findByText('0');
  let failure;await React.act(async()=>{failure=await actions.renameChat('chat-a','New').catch(e=>e);});
  assert.equal(failure.name,'ChatActionUncertainError');await screen.findByText('1');
  await React.act(async()=>actions.recordChatActivity('chat-a','Original').catch(()=>{}));assert.equal(writes,1);
});

test("Somali chat action recovery warning requires a reviewed acknowledgment", async () => {
  seed({language:'so',chats:[{id:'chat-a',title:'Qoraal',updatedAt:1}],chatProofs:{'chat-a':'proof'}});
  window.localStorage.setItem(`tflash:sync-uncertain:chat-action:vercel:${encodeURIComponent(userId)}:old`,JSON.stringify({chatId:'chat-a',action:'rename'}));
  fakeFetch();render(app(h(Sidebar,{open:true,onClose(){},onNewChat(){},onOpenSettings(){}})));
  assert.ok(await screen.findByText(/Ficil wada hadal ayaa laga yaabaa/));
  const checkbox=screen.getByRole('checkbox',{name:/Waxaan hubiyay taariikhda/});
  const button=screen.getByRole('button',{name:'Qiro oo oggolow ficillo cusub'});assert.equal(button.disabled,true);
  await userEvent.setup().click(checkbox);assert.equal(button.disabled,false);
});

test("a confirmed chat action removes an in-flight warning without acknowledging another marker", async () => {
  seed({chats:[{id:'chat-a',title:'Original',updatedAt:1}],chatProofs:{'chat-a':'proof'}});
  let resolve,started=false;const pending=new Promise(r=>{resolve=r;});
  fakeFetch((path,options)=>{if(path==='/api/chats/chat-a'&&options.method==='PATCH'){started=true;return pending;}});
  let actions;function Probe(){actions=useAppSettings();return h('p',null,String(actions.chatActionWarnings.length));}
  render(app(h(Probe)));await screen.findByText('0');let action;
  await React.act(async()=>{action=actions.renameChat('chat-a','New');});await waitFor(()=>assert.equal(started,true));
  window.localStorage.setItem(`tflash:sync-uncertain:chat-action:vercel:${encodeURIComponent(userId)}:other`,JSON.stringify({chatId:'chat-b',action:'remove'}));
  await React.act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:null})));
  await screen.findByText('2');
  await React.act(async()=>{resolve(Response.json({ok:true,title:'New'}));await action;});
  await screen.findByText('1');assert.equal(actions.chatActionWarnings[0].chatId,'chat-b');
});

function renewalTestLock() {
  Object.defineProperty(navigator, 'locks', {configurable:true,value:{request:async(_name,_opts,fn)=>fn({})}});
}
function expiringGrant(token='v1.original') {
  return {token,label:'Authorized',connectedAt:Date.now(),tokenExpiresAt:Date.now()+60_000,expiresAt:Date.now()+86_400_000,refreshable:true,source:'oauth'};
}

test('an uncertain OAuth renewal retains the grant, survives remount, and never retries automatically',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();const originalTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,calls=0,release;const pending=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/integrations/oauth/refresh'){
    calls++;signal=options.signal;const headers=new Headers(options.headers);assert.equal(headers.get('x-tflash-expected-user-id'),userId);assert.equal(headers.get('x-tflash-expected-account-kind'),'vercel');return pending;
  }});
  try {
    const mounted=render(app(h(ConnectionsPanel)));await waitFor(()=>assert.ok(signal));
    await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await screen.findByText(/The previous renewal may have rotated this grant/);
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.original');
    await React.act(async()=>{release(Response.json({ok:true,token:'v1.late'}));await pending;});
    mounted.unmount();render(app(h(ConnectionsPanel)));await screen.findByText(/The previous renewal may have rotated this grant/);
    assert.equal(calls,1);const checkbox=screen.getByRole('checkbox',{name:/I checked the provider, revoked the old grant/});
    const button=screen.getByRole('button',{name:'Acknowledge and allow renewal of the new grant'});assert.equal(button.disabled,true);
    await userEvent.setup().click(checkbox);await userEvent.setup().click(button);
    await screen.findByText(/Review is unavailable: reconnect a different grant/);assert.equal(calls,1);
  } finally {AbortSignal.timeout=originalTimeout;delete navigator.locks;}
});

test('successful OAuth renewal persists the new grant and prevents replay of a stale browser copy',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();let calls=0;
  fakeFetch((path)=>{if(path==='/api/integrations/oauth/refresh'){calls++;return Response.json({ok:true,token:'v1.rotated',expiresAt:Date.now()+86_400_000,tokenExpiresAt:Date.now()+3_600_000});}});
  try {
    const first=render(app(h(ConnectionsPanel)));await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.rotated'));
    assert.equal(calls,1);const marker=Object.keys(window.localStorage).find(k=>k.startsWith('tflash:sync-uncertain:oauth-refresh:'));
    const data=JSON.parse(window.localStorage.getItem(marker));assert.equal(data.state,'settled');assert.ok(!JSON.stringify(data).includes('v1.original'));
    first.unmount();const disk=JSON.parse(window.localStorage.getItem(storageKey));disk.integrationTokens.linear=expiringGrant();window.localStorage.setItem(storageKey,JSON.stringify(disk));
    render(app(h(ConnectionsPanel)));await screen.findByText(/This saved grant was already renewed/);assert.equal(calls,1);
  } finally {delete navigator.locks;}
});

test('OAuth renewal fails closed without browser locks or recovery storage',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});let calls=0;
  fakeFetch(path=>{if(path==='/api/integrations/oauth/refresh'){calls++;return Response.json({ok:true,token:'v1.changed'});}});
  const first=render(app(h(ConnectionsPanel)));await screen.findByText(/Automatic renewal is unavailable/);assert.equal(calls,0);first.unmount();
  renewalTestLock();const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(k,v){if(k.startsWith('tflash:sync-uncertain:oauth-refresh:'))throw new Error('denied');return original.call(this,k,v);};
  try {render(app(h(ConnectionsPanel)));await screen.findByText(/Automatic renewal is unavailable/);assert.equal(calls,0);assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.original');}
  finally {proto.setItem=original;delete navigator.locks;}
});

test('an uncertain OAuth grant requires a different reconnected grant and explicit provider review',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();const originalTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let signal,calls=0;fakeFetch((path,options)=>{if(path==='/api/integrations/oauth/refresh'){calls++;signal=options.signal;return new Promise(()=>{});}});
  let context;function Probe(){context=useAppSettings();return h(ConnectionsPanel);}
  try {
    render(app(h(Probe)));await waitFor(()=>assert.ok(signal));await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    await screen.findByText(/The previous renewal may have rotated this grant/);
    await React.act(async()=>context.connectIntegration('linear',expiringGrant('v1.new-consent')));
    await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.new-consent'));
    const user=userEvent.setup();await user.click(screen.getByRole('checkbox',{name:/I checked the provider, revoked the old grant/}));
    await user.click(screen.getByRole('button',{name:'Acknowledge and allow renewal of the new grant'}));
    await waitFor(()=>assert.equal(screen.queryByText(/The previous renewal may have rotated this grant/),null));
    assert.equal(calls,1,'acknowledgment does not itself replay or renew');
    const marker=Object.keys(window.localStorage).find(k=>k.startsWith('tflash:sync-uncertain:oauth-refresh:'));assert.equal(JSON.parse(window.localStorage.getItem(marker)).state,'settled');
  } finally {AbortSignal.timeout=originalTimeout;delete navigator.locks;}
});

test('browser coordination admits at most one simultaneous renewal for the same account and integration',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});let held=false,signal,posts=0;
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name,_options,fn)=>{
    if(held)return fn(null);held=true;try{return await fn({});}finally{held=false;}
  }}});
  const originalTimeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  fakeFetch((path,options)=>{if(path==='/api/integrations/oauth/refresh'){posts++;signal=options.signal;return new Promise(()=>{});}});
  try {
    render(h(React.Fragment,null,app(h('div',null,'First')),app(h('div',null,'Second'))));
    await waitFor(()=>assert.ok(signal));await React.act(async()=>deadlines.find(c=>c.signal===signal).abort());
    assert.equal(posts,1);assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.original');
  } finally {AbortSignal.timeout=originalTimeout;delete navigator.locks;}
});

test('server renewal error keeps the sealed grant and does not replay on the next timer tick',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();const realInterval=window.setInterval;let tick,calls=0;
  window.setInterval=(fn,ms,...args)=>{if(ms===300000){tick=fn;return 98765;}return realInterval(fn,ms,...args);};
  const realClear=window.clearInterval;window.clearInterval=id=>{if(id!==98765)realClear(id);};
  fakeFetch(path=>{if(path==='/api/integrations/oauth/refresh'){calls++;return Response.json({ok:false},{status:401});}});
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/The previous renewal may have rotated this grant/);assert.equal(calls,1);
    await React.act(async()=>tick());assert.equal(calls,1);
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.original');
  } finally {window.setInterval=realInterval;window.clearInterval=realClear;delete navigator.locks;}
});

test('failure persisting a rotated OAuth grant keeps the old copy and an uncertain marker',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  let calls=0;fakeFetch(path=>{if(path==='/api/integrations/oauth/refresh'){
    calls++;proto.setItem=function(k,v){if(k===storageKey && String(v).includes('v1.rotated'))throw new Error('quota');return original.call(this,k,v);};
    return Response.json({ok:true,token:'v1.rotated',tokenExpiresAt:Date.now()+3_600_000});
  }});
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/The previous renewal may have rotated this grant/);
    assert.equal(calls,1);assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.original');
    const key=Object.keys(window.localStorage).find(k=>k.startsWith('tflash:sync-uncertain:oauth-refresh:'));assert.equal(JSON.parse(window.localStorage.getItem(key)).state,'pending');
  } finally {proto.setItem=original;delete navigator.locks;}
});

test('successful renewal without an expiry does not automatically rotate on every timer tick',async()=>{
  seed({integrationTokens:{linear:expiringGrant()}});renewalTestLock();const realInterval=window.setInterval,realClear=window.clearInterval;let tick,calls=0;
  window.setInterval=(fn,ms,...args)=>{if(ms===300000){tick=fn;return 98765;}return realInterval(fn,ms,...args);};window.clearInterval=id=>{if(id!==98765)realClear(id);};
  fakeFetch(path=>{if(path==='/api/integrations/oauth/refresh'){calls++;return Response.json({ok:true,token:'v1.new'});}});
  try {
    render(app(h(ConnectionsPanel)));await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.new'));
    const record=JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear;assert.equal(record.tokenExpiresAt,undefined);assert.ok(record.lastRenewalAt);
    await React.act(async()=>tick());assert.equal(calls,1);
  } finally {window.setInterval=realInterval;window.clearInterval=realClear;delete navigator.locks;}
});

test('another tab rotating a grant marks the visible old copy stale even before expiry',async()=>{
  seed({integrationTokens:{linear:{...expiringGrant(),tokenExpiresAt:Date.now()+3_600_000}}});renewalTestLock();fakeFetch();
  try {
    render(app(h(ConnectionsPanel)));await screen.findByRole('button',{name:'Linear Connected'});
    const disk=JSON.parse(window.localStorage.getItem(storageKey));disk.integrationTokens.linear=expiringGrant('v1.other-tab');window.localStorage.setItem(storageKey,JSON.stringify(disk));
    await React.act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:storageKey,newValue:JSON.stringify(disk)})));
    await screen.findByText(/This saved grant was already renewed or changed in another tab/);
    assert.equal(screen.queryByRole('button',{name:'Linear Connected'}),null);
  } finally {delete navigator.locks;}
});

test('Somali OAuth renewal warning clearly requires provider review',async()=>{
  seed({language:'so',integrationTokens:{linear:expiringGrant()}});renewalTestLock();
  fakeFetch(path=>path==='/api/integrations/oauth/refresh'?Response.json({ok:false},{status:503}):undefined);
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/Cusboonaysiintii hore waxay beddeli kartay/);
    assert.equal(screen.getByRole('button',{name:'Qiro oo oggolow cusboonaysiinta rukhsadda cusub'}).disabled,true);
    assert.ok(screen.getByRole('checkbox',{name:/Waxaan hubiyay adeegga/}));
  } finally {delete navigator.locks;}
});

test("model responses are bounded to the current credential even when old fetch ignores abort", async () => {
  seed({ connections: { openrouter: { token: "v1.old", source: "browser", label: "old", connectedAt: 1 } } });
  let release, oldSignal, state;
  const old = new Promise(resolve => { release = resolve; });
  const calls = fakeFetch((path, options) => {
    if (path.startsWith('/api/providers/models?')) {
      if (options.headers['x-tflash-provider-token'] === 'v1.old' || Object.values(options.headers).includes('v1.old')) { oldSignal = options.signal; return old; }
      return Response.json({ ok: true, providerId: 'openrouter', source: 'live', models: [{ id: 'new/model' }] });
    }
  });
  function Probe() { state = useAppSettings(); return h('p', null, `${state.modelsStateFor('openrouter').source}:${state.modelsFor('openrouter').map(m=>m.id).join(',')}`); }
  render(app(h(Probe))); await waitFor(() => assert.equal(state.settings.connections.openrouter?.token, 'v1.old'));
  await React.act(async () => { void state.loadModels('openrouter'); });
  await waitFor(() => assert.ok(oldSignal));
  assert.equal(calls.find(c=>c.path.startsWith('/api/providers/models?')).options.headers['x-tflash-expected-user-id'], userId);
  await React.act(async () => { state.connect('openrouter', { token: 'v1.new', source: 'browser', label: 'new', connectedAt: 2 }); });
  assert.equal(oldSignal.aborted, true);
  await React.act(async () => { await state.loadModels('openrouter'); });
  await screen.findByText('live:new/model');
  await React.act(async () => { release(Response.json({ ok:true, providerId:'openrouter', source:'live', models:[{id:'old/model'}] })); await old; });
  assert.ok(screen.getByText('live:new/model')); assert.equal(screen.queryByText('live:old/model'), null);
});

test("model timeout and malformed live catalog require an explicit retry", async () => {
  seed(); const original = AbortSignal.timeout; const deadlines=[]; let state, calls=0;
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  fakeFetch(path=>{if(path.startsWith('/api/providers/models?')) { calls++; if(calls===1)return new Promise(()=>{}); return Response.json({ ok:true, source:'live', models:[] }); }});
  function Probe(){state=useAppSettings();const status=state.modelsStateFor('openrouter');return h('p',null,status.error??(status.loading?'loading':'idle'));}
  try {
    render(app(h(Probe))); await waitFor(()=>assert.ok(state));
    await React.act(async()=>{void state.loadModels('openrouter');});
    await screen.findByText('loading');
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await screen.findByText(/Could not load the live model list/);
    await React.act(async()=>{await state.loadModels('openrouter');}); assert.equal(calls,1);
    await React.act(async()=>{await state.loadModels('openrouter',true);}); assert.equal(calls,2);
    assert.match(state.modelsStateFor('openrouter').error,/Could not load/);
  } finally { AbortSignal.timeout=original; }
});

test("integration status malformed or stalled shows manual retry and retains local tokens", async () => {
  seed({ integrationTokens:{ github:{ token:'v1.saved', source:'oauth', connectedAt:1, expiresAt:Date.now()+3600000 } } });
  let count=0; const original=AbortSignal.timeout, deadlines=[]; AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  const calls=fakeFetch((path)=>{if(path==='/api/integrations'){count++;if(count===1)return new Promise(()=>{});if(count===2)return Response.json({integrations:[]});return Response.json({integrations:INTEGRATIONS.map(item=>({id:item.id,mode:'none',configured:false,oauthAvailable:true}))});}});
  try {
    render(app(h(ConnectionsPanel))); await waitFor(()=>assert.equal(count,1));
    assert.equal(calls.find(c=>c.path==='/api/integrations').options.headers['x-tflash-expected-account-kind'],'vercel');
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await screen.findByText(/Could not check connections/i);
    assert.ok(screen.getByRole('button',{name:/GitHub Connected/i}));
    const user=userEvent.setup(); await user.click(screen.getByRole('button',{name:'Refresh'})); await waitFor(()=>assert.equal(count,2));
    await screen.findByText(/Could not check connections/i);
    await user.click(screen.getByRole('button',{name:'Refresh'})); await waitFor(()=>assert.equal(count,3));
    await waitFor(()=>assert.equal(screen.queryByText(/Could not check connections/i),null));
  } finally {AbortSignal.timeout=original;}
});

test("late provider status cannot cross account switch", async () => {
  seed();let release;const old=new Promise(resolve=>{release=resolve;});let state;
  fakeFetch((path, options)=>{if(path==='/api/providers'){return options.headers['x-tflash-expected-user-id']===userId?old:Response.json({providers:[{id:'openrouter',envConfigured:false}]});}});
  function Probe(){state=useAppSettings();return h('p',null,String(state.envConfigured.openrouter));}
  const tree=(id)=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(Probe));
  const mounted=render(tree(userId));await waitFor(()=>assert.ok(state));mounted.rerender(tree('another-account'));
  await screen.findByText('false');
  await React.act(async()=>{release(Response.json({providers:[{id:'openrouter',envConfigured:true}]}));await old;});
  assert.ok(screen.getByText('false'));
});

test("late integration status from another account cannot expose an old consent link", async () => {
  seed();let release;const old=new Promise(resolve=>{release=resolve;});
  const calls=fakeFetch((path,options)=>{if(path==='/api/integrations')return options.headers['x-tflash-expected-user-id']===userId?old:Response.json({integrations:INTEGRATIONS.map(item=>({id:item.id,mode:'none',configured:false,oauthAvailable:false}))});});
  const tree=(id)=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(ConnectionsPanel));
  const mounted=render(tree(userId));await waitFor(()=>assert.ok(calls.find(c=>c.path==='/api/integrations')));
  const signal=calls.find(c=>c.path==='/api/integrations').options.signal;
  mounted.rerender(tree('another-account'));await waitFor(()=>assert.equal(signal.aborted,true));
  await React.act(async()=>{release(Response.json({integrations:INTEGRATIONS.map(item=>({id:item.id,mode:'none',configured:false,oauthAvailable:true}))}));await old;});
  assert.equal(screen.queryByRole('link',{name:'Connect GitHub'}),null);
});

test("provider connect timeout does not save credentials or automatically repeat", async () => {
  seed();const original=AbortSignal.timeout, deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let count=0; const calls=fakeFetch(path=>{if(path==='/api/providers/connect'){count++;return new Promise(()=>{});}});
  try {
    render(app(h(SettingsDialog,{open:true,onOpenChange(){},initialProvider:'openrouter'})));
    const user=userEvent.setup();const dialog=await screen.findByRole('dialog',{name:'Settings'});
    await user.type(within(dialog).getByLabelText(/API key/),'temporary-key');
    await user.click(within(dialog).getByRole('button',{name:'Connect',exact:true}));
    await waitFor(()=>assert.equal(count,1));
    assert.equal(calls.find(c=>c.path==='/api/providers/connect').options.headers['x-tflash-expected-user-id'],userId);
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await within(dialog).findByText('Connection failed');
    assert.equal(count,1);assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).connections.openrouter,undefined);
  } finally {AbortSignal.timeout=original;}
});

test("document import timeout preserves the draft, blocks sending while reading, and allows explicit retry", async () => {
  seed(); const timeout=AbortSignal.timeout, deadlines=[]; AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let imports=0,sends=0;const calls=fakeFetch(path=>{if(path==='/api/documents/read'){imports++;return new Promise(()=>{});}});
  try {
    render(app(h(TooltipProvider,null,h(PromptInputProvider,null,h(ChatComposer,{isBusy:false,isResuming:false,onCancel(){},onSubmit:async()=>{sends++;}})))));
    const user=userEvent.setup();await user.type(screen.getByLabelText('Message Tflash'),'Draft remains');
    const input=screen.getByLabelText('Read PDF or DOCX',{selector:'input'});
    fireEvent.change(input,{target:{files:[new File(['%PDF-x'],'sample.pdf',{type:'application/pdf'})]}});
    await screen.findByText('Reading document…');
    assert.equal(screen.getByRole('button',{name:'Send'}).disabled,true);
    await user.keyboard('{Enter}');
    fireEvent.submit(screen.getByLabelText('Message Tflash').closest('form'));
    assert.equal(sends,0); assert.equal(screen.getByLabelText('Message Tflash').value,'Draft remains');
    assert.equal(calls.find(c=>c.path==='/api/documents/read').options.headers['x-tflash-expected-user-id'],userId);
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await screen.findByText(/Could not process document/);
    assert.equal(screen.getByLabelText('Message Tflash').value,'Draft remains');assert.equal(sends,0);assert.equal(imports,1);
    assert.equal(screen.getByRole('button',{name:'Send'}).disabled,false);
    fireEvent.change(input,{target:{files:[new File(['%PDF-x'],'sample.pdf',{type:'application/pdf'})]}});
    await waitFor(()=>assert.equal(imports,2));
  } finally {AbortSignal.timeout=timeout;}
});

test("late document imports after unmount cannot add attachments", async () => {
  const { DocumentImportButton }=await import('../components/chat/documents.tsx');
  const { usePromptInputAttachments }=await import('../components/ai-elements/prompt-input.tsx');
  seed();let release,attachments,signal;const old=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/documents/read'){signal=options.signal;return old;}});
  function Reader(){attachments=usePromptInputAttachments();return h(DocumentImportButton);}
  function Harness(){const [visible,setVisible]=React.useState(true);return h(PromptInputProvider,null,h('button',{onClick:()=>setVisible(false)},'Close'),visible?h(Reader):h(Inspect));}
  function Inspect(){attachments=usePromptInputAttachments();return null;}
  render(app(h(TooltipProvider,null,h(Harness))));
  fireEvent.change(screen.getByLabelText('Read PDF or DOCX',{selector:'input'}),{target:{files:[new File(['%PDF-x'],'sample.pdf')]}});
  await waitFor(()=>assert.ok(signal));await userEvent.setup().click(screen.getByRole('button',{name:'Close'}));assert.equal(signal.aborted,true);
  await React.act(async()=>{release(Response.json({text:'late content',truncated:false}));await old;});assert.equal(attachments.files.length,0);
});

test("late export is not downloaded after document content changes", async () => {
  const { DocumentExportButtons }=await import('../components/chat/documents.tsx');seed();let release,signal,downloads=0;const old=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/documents/export'){signal=options.signal;return old;}});
  const orig=window.HTMLAnchorElement.prototype.click;window.HTMLAnchorElement.prototype.click=function(){downloads++;};
  try {
    const tree=content=>app(h(DocumentExportButtons,{filename:'report.md',content}));
    const mounted=render(tree('first'));await userEvent.setup().click(screen.getByRole('button',{name:'PDF'}));
    await waitFor(()=>assert.ok(signal));mounted.rerender(tree('new content'));assert.equal(signal.aborted,true);
    await React.act(async()=>{release(new Response('%PDF-late',{headers:{'content-type':'application/pdf'}}));await old;});
    assert.equal(downloads,0);assert.equal(screen.getByRole('button',{name:'PDF'}).disabled,false);
  } finally {window.HTMLAnchorElement.prototype.click=orig;}
});

test("document import from previous account is aborted and cannot populate the next account", async () => {
  const { DocumentImportButton }=await import('../components/chat/documents.tsx');const {usePromptInputAttachments}=await import('../components/ai-elements/prompt-input.tsx');
  seed();let release,signal,attachments;const old=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/documents/read'){signal=options.signal;return old;}});
  function Reader(){attachments=usePromptInputAttachments();return h(DocumentImportButton);}
  const tree=id=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(TooltipProvider,null,h(PromptInputProvider,null,h(Reader))));
  const mounted=render(tree(userId));
  fireEvent.change(screen.getByLabelText('Read PDF or DOCX',{selector:'input'}),{target:{files:[new File(['%PDF-x'],'private.pdf')]}});
  await waitFor(()=>assert.ok(signal));mounted.rerender(tree('other-user'));assert.equal(signal.aborted,true);
  await React.act(async()=>{release(Response.json({text:'private content',truncated:false}));await old;});
  assert.equal(attachments.files.length,0);assert.equal(screen.queryByText('Reading document…'),null);
});

test("stalled document JSON and binary bodies show failure without late attachment or download", async () => {
  const {DocumentImportButton,DocumentExportButtons}=await import('../components/chat/documents.tsx'); const {usePromptInputAttachments}=await import('../components/ai-elements/prompt-input.tsx');
  seed();const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let attachments,cancelled=0,downloads=0;
  const stalled=(headers)=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}}),{headers});
  fakeFetch(path=>path==='/api/documents/read'?stalled({'content-type':'application/json'}):path==='/api/documents/export'?stalled({'content-type':'application/pdf'}):undefined);
  function Reader(){attachments=usePromptInputAttachments();return h(DocumentImportButton);}
  const click=window.HTMLAnchorElement.prototype.click;window.HTMLAnchorElement.prototype.click=function(){downloads++;};
  try {
    render(app(h(TooltipProvider,null,h(PromptInputProvider,null,h(Reader),h(DocumentExportButtons,{filename:'report.md',content:'hello'})))));
    fireEvent.change(screen.getByLabelText('Read PDF or DOCX',{selector:'input'}),{target:{files:[new File(['%PDF-x'],'file.pdf')]}});
    await userEvent.setup().click(screen.getByRole('button',{name:'PDF'}));
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await waitFor(()=>assert.equal(screen.getAllByText(/Could not process document/).length,2));
    assert.equal(attachments.files.length,0);assert.equal(downloads,0);assert.equal(cancelled,2);
  } finally {AbortSignal.timeout=timeout;window.HTMLAnchorElement.prototype.click=click;}
});

test("Somali document timeout is visible and never sends a draft", async () => {
  seed({language:'so'});const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let calls=0,sends=0;fakeFetch(path=>{if(path==='/api/documents/read'){calls++;return new Promise(()=>{});}});
  try {
    render(app(h(TooltipProvider,null,h(PromptInputProvider,null,h(ChatComposer,{isBusy:false,isResuming:false,onCancel(){},onSubmit:async()=>{sends++;}})))));
    await waitFor(()=>assert.equal(document.documentElement.lang,'so'));
    const input=document.querySelector('input[accept=".pdf,.docx"]');
    fireEvent.change(input,{target:{files:[new File(['%PDF-x'],'file.pdf')]}});await waitFor(()=>assert.equal(calls,1));
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    assert.ok(await screen.findByText(/Dukumeentiga lama farsamayn ama wakhtigii wuu dhammaaday/));assert.equal(sends,0);
  } finally {AbortSignal.timeout=timeout;}
});

function handoffLocks() {
  const active=new Set();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name,options,callback)=>{
    if(active.has(name)) return callback(null);
    active.add(name);try{return await callback({name});}finally{active.delete(name);}
  }}});
}

test("uncertain OAuth handoff survives reload, is not retried and requires explicit provider review", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let count=0,signal;const calls=fakeFetch((path,options)=>{if(path==='/api/integrations/oauth/result'){count++;signal=options.signal;return new Promise(()=>{});}});
  try {
    const mounted=render(app(h(ConnectionsPanel)));await waitFor(()=>assert.equal(count,1));
    assert.equal(calls.find(c=>c.path==='/api/integrations/oauth/result').options.headers['x-tflash-expected-user-id'],userId);
    await screen.findByText(/provider may have created an OAuth client or granted access/i);
    const user=userEvent.setup(); await user.click(screen.getByLabelText(/I checked the provider and understand/));
    await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await screen.findByText(/Review is unavailable while another handoff/);
    await React.act(async()=>{for(const c of deadlines)c.abort();});assert.equal(signal.aborted,true);
    await waitFor(()=>assert.equal(window.location.search,''));assert.equal(count,1);
    mounted.unmount();window.history.replaceState({},'', '/?integration=linear&connected=1');render(app(h(ConnectionsPanel)));
    await screen.findByText(/provider may have created an OAuth client or granted access/i);await waitFor(()=>assert.equal(window.location.search,''));
    assert.equal(count,1);assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear,undefined);
    await user.click(screen.getByLabelText(/I checked the provider and understand/));
    await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await waitFor(()=>assert.equal(screen.queryByText(/provider may have created an OAuth client or granted access/i),null));assert.ok(await screen.findByRole('link',{name:'Connect Linear'}));assert.equal(count,1);
  } finally {AbortSignal.timeout=timeout;delete navigator.locks;}
});

test("OAuth handoff body timeout and failed durable storage never claim a connection", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let cancel=0,calls=0;
  fakeFetch(path=>{if(path==='/api/integrations/oauth/result'){calls++;return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancel++;}}),{headers:{'content-type':'application/json'}});}});
  try {
    render(app(h(ConnectionsPanel)));await waitFor(()=>assert.equal(calls,1));
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await screen.findByText(/provider may have created an OAuth client or granted access/i);assert.equal(cancel,1);
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear,undefined);
    assert.equal(screen.queryByText('Connected with one-tap authorization.'),null);
  } finally {AbortSignal.timeout=timeout;delete navigator.locks;}
});

test("OAuth handoff fails closed without browser locks or recovery storage", async () => {
  seed();window.history.replaceState({},'', '/?integration=linear&connected=1');let calls=0;
  fakeFetch(path=>{if(path==='/api/integrations/oauth/result'){calls++;return Response.json({connected:true});}});
  const mounted=render(app(h(ConnectionsPanel)));await screen.findByText(/Authorization recovery is unavailable/);assert.equal(calls,0);
  mounted.unmount();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.startsWith('tflash:sync-uncertain:oauth-handoff:'))throw new Error('denied');return original.call(this,key,value);};
  try {render(app(h(ConnectionsPanel)));await screen.findByText(/Authorization recovery is unavailable/);assert.equal(calls,0);}
  finally {proto.setItem=original;delete navigator.locks;}
});

test("a delayed OAuth handoff cannot resurrect a disconnected or replaced grant", async () => {
  seed({integrationTokens:{linear:{token:'v1.old',label:'Old',connectedAt:1,source:'oauth'}}});handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  let finish,state;const old=new Promise(resolve=>{finish=resolve;});fakeFetch(path=>path==='/api/integrations/oauth/result'?old:undefined);
  function Probe(){state=useAppSettings();return h(ConnectionsPanel);}
  try {
    render(app(h(Probe)));await screen.findByText(/provider may have created an OAuth client or granted access/i);
    await React.act(async()=>state.disconnectIntegration('linear'));
    await React.act(async()=>{finish(Response.json({connected:true,integrationId:'linear',token:'v1.late',expiresAt:Date.now()+86400000}));await old;});
    await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear,undefined));
    assert.ok(screen.getByText(/provider may have created an OAuth client or granted access/i));assert.equal(screen.queryByText('Connected with one-tap authorization.'),null);
  } finally {delete navigator.locks;}
});

test("Somali handoff uncertainty warns before an explicit acknowledgment", async () => {
  seed({language:'so'});handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  fakeFetch(path=>path==='/api/integrations/oauth/result'?Response.json({connected:false}):undefined);
  try {
    render(app(h(ConnectionsPanel)));
    assert.ok(await screen.findByText(/Adeeggu OAuth client wuu samayn karay/));
    assert.equal(screen.getByRole('button',{name:'Qiro dib-u-eegista'}).disabled,true);
  } finally {delete navigator.locks;}
});

test("a handoff response is not called connected when the sealed grant cannot be persisted", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key===storageKey && String(value).includes('v1.new-grant')) throw new Error('storage denied');return original.call(this,key,value);};
  fakeFetch(path=>path==='/api/integrations/oauth/result'?Response.json({connected:true,integrationId:'linear',token:'v1.new-grant',expiresAt:Date.now()+60000}):undefined);
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/provider may have created an OAuth client or granted access/i);
    await waitFor(()=>assert.equal(window.location.search,''));
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear,undefined);
    assert.equal(screen.queryByText('Connected with one-tap authorization.'),null);
    const keys=Object.keys(window.localStorage).filter(k=>k.startsWith('tflash:sync-uncertain:oauth-handoff:'));
    assert.equal(keys.length,1);assert.doesNotMatch(window.localStorage.getItem(keys[0]),/v1\.new-grant/);
  } finally {proto.setItem=original;delete navigator.locks;}
});

test("a late handoff from an earlier account cannot populate a new account", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');
  let finish,signal;const old=new Promise(resolve=>{finish=resolve;});
  fakeFetch((path,options)=>{if(path==='/api/integrations/oauth/result'){signal=options.signal;return old;}});
  let state;function Probe(){state=useAppSettings();return h(ConnectionsPanel);}
  const tree=id=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(Probe));
  try {
    const mounted=render(tree(userId));await waitFor(()=>assert.ok(signal));
    window.history.replaceState({},'', '/');mounted.rerender(tree('other-account'));await waitFor(()=>assert.equal(signal.aborted,true));
    await React.act(async()=>{finish(Response.json({connected:true,integrationId:'linear',token:'v1.late',expiresAt:Date.now()+60000}));await old;});
    assert.equal(state.accountId,'other-account');assert.equal(state.settings.integrationTokens.linear,undefined);
    assert.equal(screen.queryByText('Connected with one-tap authorization.'),null);
  } finally {delete navigator.locks;}
});

test("Strict Mode does not duplicate an OAuth handoff read", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');let calls=0;
  fakeFetch(path=>{if(path==='/api/integrations/oauth/result'){calls++;return Response.json({connected:true,integrationId:'linear',token:'v1.strict',expiresAt:Date.now()+3600000});}});
  try {
    render(h(React.StrictMode,null,app(h(ConnectionsPanel))));
    await screen.findByText('Connected with one-tap authorization.');assert.equal(calls,1);
    assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear.token,'v1.strict');
  } finally {delete navigator.locks;}
});

test("same-browser concurrent handoff readers do not dispatch twice", async () => {
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&connected=1');let calls=0,resolve;
  const request=new Promise(r=>{resolve=r;});fakeFetch(path=>{if(path==='/api/integrations/oauth/result'){calls++;return request;}});
  try {
    render(h(React.Fragment,null,app(h(ConnectionsPanel)),app(h(ConnectionsPanel))));
    await waitFor(()=>assert.equal(calls,1));
    await React.act(async()=>{resolve(Response.json({connected:true,integrationId:'linear',token:'v1.once',expiresAt:Date.now()+3600000}));await request;});
    await waitFor(()=>assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear?.token,'v1.once'));
    assert.equal(calls,1);
  } finally {delete navigator.locks;}
});

test('uncertain OAuth exchange redirects persist review, never trigger a new attempt, and require acknowledgment',async()=>{
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&oauth=exchange_uncertain');
  let calls=0;fakeFetch(path=>{if(path.includes('/api/integrations/oauth/')){calls++;throw new Error('no replay');}});
  try {
    const mounted=render(app(h(ConnectionsPanel)));
    await screen.findByText(/authorization code exchange could not be confirmed/i);
    await screen.findByText(/provider may have created an OAuth client or granted access/i);
    await waitFor(()=>assert.equal(window.location.search,''));assert.equal(calls,0);
    assert.equal(screen.queryByRole('link',{name:'Connect Linear'}),null);
    mounted.unmount();render(app(h(ConnectionsPanel)));
    await screen.findByText(/provider may have created an OAuth client or granted access/i);
    const user=userEvent.setup();await user.click(screen.getByLabelText(/I checked the provider and understand/));
    await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await screen.findByRole('link',{name:'Connect Linear'});assert.equal(calls,0);
  } finally {delete navigator.locks;}
});

test('uncertain registration keeps a durable warning without locks and keeps URL if storage fails',async()=>{
  seed();window.history.replaceState({},'', '/?integration=linear&oauth=registration_uncertain');let calls=0;
  fakeFetch(path=>{if(path.includes('/api/integrations/oauth/'))calls++;});
  let mounted=render(app(h(ConnectionsPanel)));
  await screen.findByText(/OAuth client registration could not be confirmed/i);
  await screen.findByText(/provider may have created an OAuth client or granted access/i);
  assert.equal(calls,0);await waitFor(()=>assert.equal(window.location.search,''));
  mounted.unmount();window.localStorage.clear();window.history.replaceState({},'', '/?integration=linear&oauth=registration_uncertain');
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.startsWith('tflash:sync-uncertain:oauth-handoff:'))throw new Error('denied');return original.call(this,key,value);};
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/Authorization recovery is unavailable/);
    assert.match(window.location.search,/oauth=registration_uncertain/);assert.equal(calls,0);
  } finally {proto.setItem=original;}
});

test('Somali uncertain OAuth exchange offers review rather than claiming refusal',async()=>{
  seed({language:'so'});handoffLocks();window.history.replaceState({},'', '/?integration=linear&oauth=exchange_uncertain');fakeFetch();
  try {
    render(app(h(ConnectionsPanel)));assert.ok(await screen.findByText(/Beddelka code-ka fasaxa lama xaqiijin/));
    assert.equal(screen.queryByText('Adeeggu wuu diiday beddelka token-ka.'),null);
  } finally {delete navigator.locks;}
});

test('legacy OAuth exchange failure is treated as unconfirmed and held for review',async()=>{
  seed();handoffLocks();window.history.replaceState({},'', '/?integration=linear&oauth=exchange');fakeFetch();
  try {
    render(app(h(ConnectionsPanel)));await screen.findByText(/authorization code exchange could not be confirmed/i);
    await screen.findByText(/provider may have created an OAuth client or granted access/i);
    assert.equal(screen.queryByRole('link',{name:'Connect Linear'}),null);
  } finally {delete navigator.locks;}
});

test('uncertain permission grant survives reload, blocks replay, but emergency revoke stays available',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();
  const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let writes=0,revokes=0,signal;
  const calls=fakeFetch((path,options)=>{
    if(path.endsWith('/permissions/revoke-all')){revokes++;return Response.json({revoked:true});}
    if(path.endsWith('/permissions')){if(options.method==='POST'){writes++;signal=options.signal;return new Promise(()=>{});}return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}
  });
  try {
    const mounted=render(app(h(PermissionsPanel,{sessionId:'chat-a',ownerProof:'proof'})));const user=userEvent.setup();
    await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
    const field=screen.getByLabelText('HTTPS homepage');await user.type(field,'https://private.example');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));
    await waitFor(()=>assert.equal(writes,1));assert.equal(calls.find(c=>c.options.method==='POST').options.headers['x-tflash-expected-user-id'],userId);
    await React.act(async()=>{for(const c of deadlines)c.abort();});assert.equal(signal.aborted,true);
    await screen.findByText(/A previous change may have completed/);assert.equal(field.value,'https://private.example');
    const keys=Object.keys(window.localStorage).filter(k=>k.startsWith('tflash:sync-uncertain:control-permission:'));assert.equal(keys.length,1);assert.doesNotMatch(window.localStorage.getItem(keys[0]),/private\.example|proof/);
    await user.click(screen.getByRole('button',{name:'Refresh permissions'}));await screen.findByText('No active reusable permissions.');
    assert.equal(screen.getByRole('button',{name:'Allow homepage for one hour'}).disabled,true);
    await user.click(screen.getByRole('button',{name:'Revoke all reusable permissions'}));await screen.findByText(/Reusable permissions revoked/);assert.equal(revokes,1);assert.equal(writes,1);
    mounted.unmount();render(app(h(PermissionsPanel,{sessionId:'chat-a',ownerProof:'proof'})));await user.click(screen.getByText('Permissions for this conversation'));
    await screen.findByText(/A previous change may have completed/);assert.equal(writes,1);
    await user.click(screen.getByLabelText(/I reviewed the state and understand/));await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await waitFor(()=>assert.equal(screen.queryByText(/A previous change may have completed/),null));assert.equal(writes,1);
  } finally {AbortSignal.timeout=timeout;}
});

test('stalled task response keeps draft and blocks writes across remount until explicit review',async()=>{
  const {TrackedTaskPanel}=await import('../components/chat/tracked-task-panel.tsx');seed();const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let puts=0,cancelled=false;
  fakeFetch((path,options)=>{if(path.endsWith('/task')){if(options.method==='PUT'){puts++;return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}));}return Response.json({task:null});}});
  try {
    const mounted=render(app(h(TrackedTaskPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Track a file criterion'));
    await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Save or replace tracked task'}).disabled,false));
    await user.type(screen.getByLabelText('Objective'),'Keep this draft');await user.type(screen.getByLabelText('Workspace-relative file path'),'out.txt');await user.type(screen.getByLabelText('Expected SHA-256 (64 hexadecimal characters)'),'a'.repeat(64));
    await user.click(screen.getByRole('button',{name:'Save or replace tracked task'}));await waitFor(()=>assert.equal(puts,1));
    await React.act(async()=>{for(const c of deadlines)c.abort();});assert.equal(cancelled,true);await screen.findByText(/A previous change may have completed/);
    assert.equal(screen.getByLabelText('Objective').value,'Keep this draft');
    await user.click(screen.getByRole('button',{name:'Refresh task'}));await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Save or replace tracked task'}).disabled,true));
    mounted.unmount();render(app(h(TrackedTaskPanel,{sessionId:'chat-a'})));await user.click(screen.getByText('Track a file criterion'));
    await screen.findByText(/A previous change may have completed/);assert.equal(puts,1);
    await user.click(screen.getByLabelText(/I reviewed the state and understand/));await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await waitFor(()=>assert.equal(screen.queryByText(/A previous change may have completed/),null));assert.equal(puts,1);
  } finally {AbortSignal.timeout=timeout;}
});

test('control snapshots reject malformed data rather than claiming permissions or task state',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');const {TrackedTaskPanel}=await import('../components/chat/tracked-task-panel.tsx');seed();
  fakeFetch(path=>path.endsWith('/permissions')?Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[{origin:'https://evil.test/path',revision:'11111111-1111-4111-8111-111111111111',expiresAt:'2030-01-01T00:00:00Z'}]}):path.endsWith('/task')?Response.json({task:{objective:'bad'}}):undefined);
  render(app(h(React.Fragment,null,h(PermissionsPanel,{sessionId:'chat-a'}),h(TrackedTaskPanel,{sessionId:'chat-a'}))));const user=userEvent.setup();
  await user.click(screen.getByText('Permissions for this conversation'));await user.click(screen.getByText('Track a file criterion'));
  await screen.findByText(/Could not load or confirm permissions/);await screen.findByText(/Task storage unavailable or invalid input/);
  assert.equal(screen.queryByText('No active reusable permissions.'),null);
  assert.equal(screen.getByRole('button',{name:'Allow homepage for one hour'}).disabled,true);assert.equal(screen.getByRole('button',{name:'Save or replace tracked task'}).disabled,true);
});

test('recovery storage failure blocks grants but never prevents an explicit emergency revoke',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();let grants=0,revokes=0;
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.startsWith('tflash:sync-uncertain:control-permission:'))throw new Error('blocked');return original.call(this,key,value);};
  fakeFetch((path,options)=>{if(path.endsWith('/permissions/revoke-all')){revokes++;return Response.json({error:'unknown'},{status:503});}if(path.endsWith('/permissions')){if(options.method==='POST')grants++;return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  try {
    render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
    await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));
    await screen.findByText(/Recovery storage is unavailable/);assert.equal(grants,0);
    await user.click(screen.getByRole('button',{name:'Revoke all reusable permissions'}));await waitFor(()=>assert.equal(revokes,1));
    assert.equal(screen.queryByText(/Reusable permissions revoked/),null);
  } finally {proto.setItem=original;}
});

test('in-flight permission grant cannot be acknowledged and emergency revoke interrupts it without clearing its marker',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();let signal,post=0,all=0;
  fakeFetch((path,options)=>{if(path.endsWith('/permissions/revoke-all')){all++;return Response.json({revoked:true});}if(path.endsWith('/permissions')){if(options.method==='POST'){post++;signal=options.signal;return new Promise(()=>{});}return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
  await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));
  await waitFor(()=>assert.equal(post,1));await user.click(screen.getByLabelText(/I reviewed the state and understand/));
  assert.equal(screen.getByRole('button',{name:'Acknowledge review'}).disabled,true);
  await user.click(screen.getByRole('button',{name:'Revoke all reusable permissions'}));assert.equal(signal.aborted,true);await screen.findByText(/Reusable permissions revoked/);
  assert.equal(all,1);assert.equal(post,1);assert.ok(screen.getByText(/A previous change may have completed/));
});

test('permission and task list timeouts release busy and require manual refresh',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');const {TrackedTaskPanel}=await import('../components/chat/tracked-task-panel.tsx');seed();
  const timeout=AbortSignal.timeout,deadlines=[];AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  let permissions=0,tasks=0;fakeFetch((path)=>{
    if(path.endsWith('/permissions')){permissions++;return permissions===1?new Promise(()=>{}):Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}
    if(path.endsWith('/task')){tasks++;return tasks===1?new Promise(()=>{}):Response.json({task:null});}
  });
  try {
    render(app(h(React.Fragment,null,h(PermissionsPanel,{sessionId:'chat-a'}),h(TrackedTaskPanel,{sessionId:'chat-a'}))));const user=userEvent.setup();
    await user.click(screen.getByText('Permissions for this conversation'));await user.click(screen.getByText('Track a file criterion'));
    await waitFor(()=>{assert.equal(permissions,1);assert.equal(tasks,1);});
    await React.act(async()=>{for(const c of deadlines)c.abort();});
    await screen.findByText(/Could not load or confirm permissions/);await screen.findByText(/Task storage unavailable or invalid input/);
    assert.equal(Object.keys(window.localStorage).filter(k=>k.includes(':control-permission:')||k.includes(':control-task:')).length,0);
    await user.click(screen.getByRole('button',{name:'Refresh permissions'}));await user.click(screen.getByRole('button',{name:'Refresh task'}));
    await screen.findByText('No active reusable permissions.');await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Save or replace tracked task'}).disabled,false));
    assert.equal(permissions,2);assert.equal(tasks,2);
  } finally {AbortSignal.timeout=timeout;}
});

test('control recovery markers are session scoped and malformed markers fail closed',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();
  const key='tflash:sync-uncertain:control-permission:vercel:ui-test:test';window.localStorage.setItem(key,JSON.stringify({sessionId:'chat-a',action:'grant'}));
  fakeFetch(path=>path.endsWith('/permissions')?Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]}):undefined);
  const tree=id=>app(h(PermissionsPanel,{sessionId:id}));const mounted=render(tree('chat-b'));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));
  await screen.findByText('No active reusable permissions.');assert.equal(screen.queryByText(/A previous change may have completed/),null);
  mounted.rerender(tree('chat-a'));await screen.findByText(/A previous change may have completed/);
  window.localStorage.setItem(key,'corrupt');await React.act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key})));mounted.rerender(tree('chat-b'));
  await screen.findByText(/A previous change may have completed/);assert.equal(screen.getByRole('button',{name:'Allow homepage for one hour'}).disabled,true);
});

test('late continuation begin after an account switch never starts the agent',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let release,started=0,signal;
  const delayed=new Promise(resolve=>{release=resolve;});
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='GET')return Response.json({attempt:null,history:[]});
    const body=JSON.parse(options.body);if(body.action==='begin'){signal=options.signal;return delayed;}return Response.json({ok:true});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const tree=id=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{started++;},onRefreshTask(){}}));
  const mounted=render(tree(userId));const user=userEvent.setup();await user.click(await screen.findByLabelText(/I reviewed the prior turn and external effects/i));
  await user.click(screen.getByRole('button',{name:/Start one budgeted turn/i}));await waitFor(()=>assert.ok(signal));
  mounted.rerender(tree('another-user'));assert.equal(signal.aborted,true);
  await React.act(async()=>{release(Response.json({ok:true}));await delayed;});assert.equal(started,0);
});

test('Somali permission uncertainty describes review without claiming cancellation',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed({language:'so'});
  window.localStorage.setItem('tflash:sync-uncertain:control-permission:vercel:ui-test:one',JSON.stringify({sessionId:'chat-a',action:'grant'}));
  fakeFetch(path=>path.endsWith('/permissions')?Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]}):undefined);
  render(app(h(PermissionsPanel,{sessionId:'chat-a'})));await userEvent.setup().click(await screen.findByText('Oggolaanshaha wada sheekaysigan'));
  assert.ok(await screen.findByText(/Isbeddel hore wuu dhammayn karay/));assert.ok(screen.getByText('Oggolaansho la bixiyey'));
  assert.equal(screen.getByRole('button',{name:'Qiro dib-u-eegista'}).disabled,true);
});

test('HTTP 503 after a control mutation retains an uncertain marker even after a successful refresh',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();let changes=0;
  fakeFetch((path,options)=>{if(path.endsWith('/permissions')){if(options.method==='POST'){changes++;return Response.json({error:'unavailable'},{status:503});}return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
  await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));
  await screen.findByText(/A previous change may have completed/);await user.click(screen.getByRole('button',{name:'Refresh permissions'}));await screen.findByText('No active reusable permissions.');
  assert.equal(changes,1);assert.equal(screen.getByRole('button',{name:'Allow homepage for one hour'}).disabled,true);
});

test('a conflict without an explicit pre-dispatch assertion remains uncertain',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();let attempts=0;
  fakeFetch((path,options)=>{if(path.endsWith('/permissions')){if(options.method==='POST'){attempts++;return Response.json({error:'conflict'},{status:409});}return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
  await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));
  await screen.findByText(/A previous change may have completed/);assert.equal(attempts,1);
  await user.click(screen.getByRole('button',{name:'Refresh permissions'}));await screen.findByText('No active reusable permissions.');
  assert.equal(screen.getByRole('button',{name:'Allow homepage for one hour'}).disabled,true);
});

test('unmounting a pending control write retains its warning without replay',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();let writes=0,signal;
  fakeFetch((path,options)=>{if(path.endsWith('/permissions')){if(options.method==='POST'){writes++;signal=options.signal;return new Promise(()=>{});}return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  const mounted=render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
  await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));await waitFor(()=>assert.equal(writes,1));
  mounted.unmount();assert.equal(signal.aborted,true);render(app(h(PermissionsPanel,{sessionId:'chat-a'})));await user.click(screen.getByText('Permissions for this conversation'));
  await screen.findByText(/A previous change may have completed/);assert.equal(writes,1);
});

test('oversized success or marker deletion failure cannot silently clear control uncertainty',async()=>{
  const {PermissionsPanel}=await import('../components/chat/permissions-panel.tsx');seed();
  fakeFetch((path,options)=>{if(path.endsWith('/permissions')){if(options.method==='POST')return new Response('{}',{headers:{'content-length':'600000'}});return Response.json({epoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',grants:[]});}});
  const mounted=render(app(h(PermissionsPanel,{sessionId:'chat-a'})));const user=userEvent.setup();await user.click(screen.getByText('Permissions for this conversation'));await screen.findByText('No active reusable permissions.');
  await user.type(screen.getByLabelText('HTTPS homepage'),'https://example.com');await user.click(screen.getByRole('button',{name:'Allow homepage for one hour'}));await screen.findByText(/A previous change may have completed/);
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.removeItem;
  proto.removeItem=function(key){if(key.includes(':control-permission:'))throw new Error('blocked');return original.call(this,key);};
  try {await user.click(screen.getByLabelText(/I reviewed the state and understand/));await user.click(screen.getByRole('button',{name:'Acknowledge review'}));assert.ok(screen.getByText(/Could not save the review/));assert.ok(screen.getByText(/A previous change may have completed/));}
  finally {proto.removeItem=original;mounted.unmount();}
});

test('uncertain reservation stays blocked after empty refresh and reload without replay',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();const realTimeout=AbortSignal.timeout, deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};let posts=0,sends=0,postSignal;
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST'){posts++;postSignal=options.signal;return new Promise(()=>{});}return Response.json({attempt:null,history:[]});}});
  const task={objective:'private objective',path:'private.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={sessionId:'chat-a',ownerProof:'private-proof',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask(){}};
  try {
    const view=render(app(h(TaskContinuation,props)));const user=userEvent.setup();await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));
    await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));await waitFor(()=>assert.equal(posts,1));
    await React.act(async()=>deadlines.at(-1).abort());assert.equal(postSignal.aborted,true);
    await screen.findByText('Reserve a continuation');await waitFor(()=>assert.ok(screen.getByRole('button',{name:'Start one budgeted turn'}).disabled));
    const keys=Object.keys(window.localStorage).filter(k=>k.includes(':control-continuation:'));assert.equal(keys.length,1);
    assert.doesNotMatch(window.localStorage.getItem(keys[0]),/private|proof|aaaa|attemptId/);
    view.unmount();render(app(h(TaskContinuation,props)));await screen.findByText('Reserve a continuation');assert.equal(posts,1);assert.equal(sends,0);
    await user.click(screen.getByLabelText(/I reviewed the state and understand/));await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
    await waitFor(()=>assert.equal(screen.queryByText('Reserve a continuation'),null));assert.equal(posts,1);assert.equal(sends,0);
  } finally {AbortSignal.timeout=realTimeout;}
});

test('unconfirmed resolve blocks a new start even if the ledger refresh is empty',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let posts=0,attempt={attemptId:crypto.randomUUID(),reviewRevision:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),holdNote:null,holdAt:null};
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST'){posts++;attempt=null;return Response.json({error:'lost'},{status:503});}return Response.json({attempt,history:[]});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{throw new Error('must not send')},onRefreshTask(){}})));
  const user=userEvent.setup();await user.type(await screen.findByLabelText(/What did you check/),'The service status is uncertain.');await user.click(screen.getByRole('checkbox',{name:/I inspected the conversation/}));
  await user.click(screen.getByRole('button',{name:'Confirm review and release hold'}));await screen.findByText('Release a continuation hold');
  await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Start one budgeted turn'}).disabled,true));assert.equal(posts,1);
});

test('holding an unresolved continuation remains possible despite warning or blocked marker storage',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let holds=0;
  let attempt={attemptId:crypto.randomUUID(),reviewRevision:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),holdNote:null,holdAt:null};
  window.localStorage.setItem('tflash:sync-uncertain:control-continuation:vercel:ui-test:one',JSON.stringify({sessionId:'chat-a',action:'begin'}));
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.includes(':control-continuation:'))throw new Error('blocked');return original.call(this,key,value);};
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST'){holds++;const body=JSON.parse(options.body);assert.equal(body.action,'hold');attempt={...attempt,reviewRevision:crypto.randomUUID(),holdNote:body.note,holdAt:new Date().toISOString()};return Response.json({ok:true});}return Response.json({attempt,history:[]});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  try {
    render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask(){}})));const user=userEvent.setup();
    await screen.findByText('Begin a continuation');await user.type(await screen.findByLabelText(/What did you check/),'External effect remains uncertain.');
    await user.click(screen.getByRole('button',{name:'Save note and keep on hold'}));await screen.findByText(/Last unresolved note: External effect remains uncertain/);
    assert.equal(holds,1);assert.ok(screen.getByText('Begin a continuation'));assert.ok(screen.getByText(/Recovery storage is unavailable/));
    assert.equal(screen.getByRole('button',{name:'Confirm review and release hold'}).disabled,true);
  } finally {proto.setItem=original;}
});

test('malformed continuation snapshot fails closed and manual refresh can recover',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let reads=0,posts=0;
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST'){posts++;return Response.json({ok:true});}return Response.json(++reads===1?{attempt:null,history:[null]}:{attempt:null,history:[]});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask(){}})));const user=userEvent.setup();
  await screen.findByRole('alert');assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);assert.equal(posts,0);
  await user.click(screen.getByRole('button',{name:'Refresh continuation'}));await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/});assert.equal(posts,0);
});

test('continuation hides old account data in the commit before effects clear state',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();const seen=[];
  const attempt={attemptId:crypto.randomUUID(),reviewRevision:crypto.randomUUID(),state:'dispatching',createdAt:new Date().toISOString(),holdNote:'Private previous account note',holdAt:new Date().toISOString()};
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations'))return options.headers['x-tflash-expected-user-id']===userId?Response.json({attempt,history:[]}):new Promise(()=>{});});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  function Probe({id}){React.useLayoutEffect(()=>{seen.push({id,text:document.body.textContent});},[id]);return h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask(){}});}
  const tree=id=>h(AppSettingsProvider,{userId:id,accountKind:'vercel'},h(Probe,{id}));const view=render(tree(userId));await screen.findByText(/Private previous account note/);
  view.rerender(tree('other-user'));assert.equal(seen.at(-1).id,'other-user');assert.doesNotMatch(seen.at(-1).text,/Private previous account note|Dispatch began but the outcome is unknown/);
});

test('continuation 409 clears uncertainty only for an explicit server pre-dispatch rejection',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let asserted=false,posts=0;
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST'){posts++;return Response.json(asserted?{continuationNotStarted:true}:{error:'conflict'},{status:409});}return Response.json({attempt:null,history:[]});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{throw new Error('must not send')},onRefreshTask(){}})));const user=userEvent.setup();
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await screen.findByText('Reserve a continuation');await user.click(screen.getByLabelText(/I reviewed the state and understand/));await user.click(screen.getByRole('button',{name:'Acknowledge review'}));
  await waitFor(()=>assert.equal(screen.queryByText('Reserve a continuation'),null));asserted=true;
  await user.click(screen.getByRole('checkbox',{name:/explicitly authorize one new turn/}));await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await waitFor(()=>assert.equal(posts,2));await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Refresh continuation'}).disabled,false));
  assert.equal(screen.queryByText('Reserve a continuation'),null);
});

test('Somali continuation warning blocks a new start until explicit review',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed({language:'so'});
  window.localStorage.setItem('tflash:sync-uncertain:control-continuation:vercel:ui-test:one',JSON.stringify({sessionId:'chat-a',action:'reserve'}));
  fakeFetch(path=>path.endsWith('/task/continuations')?Response.json({attempt:null,history:[]}):undefined);
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask(){}})));
  await screen.findByText('Qabashada sii-wadista');assert.ok(screen.getByText(/Isbeddel hore wuu dhammayn karay/));
  assert.equal(screen.getByRole('button',{name:'Qiro dib-u-eegista'}).disabled,true);
});

test('continuation marker storage failure prevents new reservations before dispatch',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let posts=0;
  const proto=Object.getPrototypeOf(window.localStorage),original=proto.setItem;
  proto.setItem=function(key,value){if(key.includes(':control-continuation:'))throw new Error('blocked');return original.call(this,key,value);};
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='POST')posts++;return Response.json({attempt:null,history:[]});}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  try {render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{throw new Error('must not send')},onRefreshTask(){}})));const user=userEvent.setup();
    await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
    await screen.findByText(/Recovery storage is unavailable/);assert.equal(posts,0);assert.equal(screen.getByRole('button',{name:'Start one budgeted turn'}).disabled,true);
  } finally {proto.setItem=original;}
});

test('unmount during an uncertain begin leaves its durable marker and never sends late',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();let attempt=null,release,begun=false,sends=0;
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='GET')return Response.json({attempt,history:[]});const body=JSON.parse(options.body);
    if(body.action==='reserve'){attempt={attemptId:body.attemptId,reviewRevision:crypto.randomUUID(),state:'reserved',createdAt:new Date().toISOString(),holdNote:null,holdAt:null};return Response.json({ok:true});}
    if(body.action==='begin'){begun=true;return new Promise(resolve=>{release=resolve;});}}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  const props={sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask(){}};const view=render(app(h(TaskContinuation,props))),user=userEvent.setup();
  await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));
  await waitFor(()=>assert.equal(begun,true));view.unmount();await React.act(async()=>release(Response.json({ok:true})));render(app(h(TaskContinuation,props)));
  await screen.findByText('Begin a continuation');assert.equal(sends,0);assert.ok(await screen.findByText(/Reserved; it is not confirmed/));
});

test('a stalled begin response body keeps its marker and cannot dispatch a turn',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();const realTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};let attempt=null,sends=0,begins=0,cancelled=false;
  fakeFetch((path,options)=>{if(path.endsWith('/task/continuations')){if(options.method==='GET')return Response.json({attempt,history:[]});const data=JSON.parse(options.body);
    if(data.action==='reserve'){attempt={attemptId:data.attemptId,reviewRevision:crypto.randomUUID(),state:'reserved',createdAt:new Date().toISOString(),holdNote:null,holdAt:null};return Response.json({ok:true});}
    if(data.action==='begin'){begins++;attempt={...attempt,state:'dispatching',reviewRevision:crypto.randomUUID()};return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}));}}});
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  try {render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{sends++;},onRefreshTask(){}})));const user=userEvent.setup();
    await user.click(await screen.findByRole('checkbox',{name:/explicitly authorize one new turn/}));await user.click(screen.getByRole('button',{name:'Start one budgeted turn'}));await waitFor(()=>assert.equal(begins,1));
    await React.act(async()=>deadlines.at(-1).abort());await screen.findByText('Begin a continuation');await screen.findByText(/Dispatch began but the outcome is unknown/);
    assert.equal(cancelled,true);assert.equal(sends,0);assert.equal(begins,1);
  } finally {AbortSignal.timeout=realTimeout;}
});

test('an oversized continuation ledger is not treated as empty',async()=>{
  const {TaskContinuation}=await import('../components/chat/task-continuation.tsx');seed();
  fakeFetch(path=>path.endsWith('/task/continuations')?new Response('{}',{headers:{'content-length':'131073'}}):undefined);
  const task={objective:'Task',path:'out.txt',sha256:'a'.repeat(64),revision:'r1',continuationBudget:1,state:'awaiting_evidence',verifiedAt:null,reason:null};
  render(app(h(TaskContinuation,{sessionId:'chat-a',task,disabled:false,onContinue:async()=>{},onRefreshTask(){}})));
  await screen.findByRole('alert');assert.equal(screen.queryByRole('button',{name:'Start one budgeted turn'}),null);
});
