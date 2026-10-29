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
});

test("a forged or lost OAuth handoff does not show a connection success", async () => {
  seed();
  window.history.replaceState({}, "", "/?integration=linear&connected=1");
  fakeFetch((path) => path === "/api/integrations/oauth/result" ? Response.json({ connected: false }) : undefined);
  render(app(h(ConnectionsPanel)));
  assert.match((await screen.findByRole("alert")).textContent, /Authorization did not finish/);
  assert.equal(screen.queryByRole("status"), null);
  assert.ok(await screen.findByRole("link", { name: "Connect Linear" }));
  assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear, undefined);
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
  let finish;
  const renewal = new Promise((resolve) => { finish = resolve; });
  const calls = fakeFetch((path) => path === "/api/integrations/oauth/refresh" ? renewal : undefined);
  render(app(h(ConnectionsPanel)));
  await waitFor(() => assert.ok(calls.some((item) => item.path === "/api/integrations/oauth/refresh")));
  await userEvent.setup().click(screen.getByRole("button", { name: "Disconnect" }));
  await React.act(async () => {
    finish(Response.json({ ok: true, token: "v1.renewed", expiresAt: Date.now() + 86400000, tokenExpiresAt: Date.now() + 3600000 }));
    await renewal;
  });
  assert.equal(JSON.parse(window.localStorage.getItem(storageKey)).integrationTokens.linear, undefined);
  assert.ok(await screen.findByRole("link", { name: "Connect Linear" }));
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
  assert.ok(within(panel).getByText("1/2 Dhammaatay"));
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
  await user.click(await screen.findByRole("button", { name: "Continue task" }));
  assert.equal(attempts, 1);
  assert.equal(screen.getByRole("button", { name: "Working" }).disabled, true);
  await React.act(async () => { rejectAttempt(new Error("offline")); try { await pending; } catch {} });
  assert.ok(screen.getByRole("alert"));
  assert.equal(screen.getByRole("button", { name: "Continue task" }).disabled, false);
  rendered.rerender(app(h(AgentPlanCard, { plan, runState: "working", onContinue })));
  assert.equal(screen.queryByRole("button", { name: "Continue task" }), null);
  rendered.rerender(app(h(AgentPlanCard, { plan: { ...plan, steps: [{ ...plan.steps[0], status: "completed" }] }, runState: "idle", onContinue })));
  assert.equal(screen.queryByRole("button", { name: "Continue task" }), null);
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
  const context = { session: { id: "ui-research", auth: { current: { principalId: userId, principalType: "user" } } } };
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
  await userEvent.setup().click(await screen.findByText("Ficillada iyo isticmaalka · 1"));
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
