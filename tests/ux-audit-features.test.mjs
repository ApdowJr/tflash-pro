import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/",
  pretendToBeVisual: true,
});
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent",
  "KeyboardEvent", "File", "FileReader", "Blob", "DOMRect", "DataTransfer",
  "localStorage", "sessionStorage",
]) {
  if (dom.window[key] !== undefined) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
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
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
register();

const React = await import("react");
const { render, screen, waitFor, cleanup, fireEvent, within } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { deriveChatTitle, sessionTitle } = await import("../lib/chat-history.ts");
const { AppSettingsProvider, useAppSettings } = await import("../components/settings/app-settings.tsx");
const { ConnectivityBanner } = await import("../components/app/connectivity-banner.tsx");
const { NotFoundState } = await import("../components/app/not-found-state.tsx");
const { EmptyState } = await import("../components/workspace/empty-state.tsx");
const { Sidebar } = await import("../components/workspace/sidebar.tsx");
const { TopBar } = await import("../components/workspace/top-bar.tsx");
const { ChatComposer } = await import("../components/chat/chat-composer.tsx");
const { CoderWorkspace } = await import("../components/coder/coder-workspace.tsx");
const { AgentArtifactCard } = await import("../components/chat/agent-workspace.tsx");
const { WorkspacePanel } = await import("../components/settings/workspace-panel.tsx");
const { PromptInputProvider } = await import("../components/ai-elements/prompt-input.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");
const { agentModeStorageKey } = await import("../lib/agent-modes.ts");
const { INTEGRATIONS } = await import("../lib/integrations/catalog.ts");

const realFetch = globalThis.fetch;
const realClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const h = React.createElement;
const userId = "audit-ui";
const storageKey = `tflash:settings:v1:${userId}`;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  if (realClipboard) Object.defineProperty(navigator, "clipboard", realClipboard);
  else delete navigator.clipboard;
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

function seed({ language = "en", chats = [], chatProofs = {} } = {}) {
  window.localStorage.setItem("tflash:language", language);
  window.localStorage.setItem(storageKey, JSON.stringify({ language, chats, chatProofs, connections: {}, integrationTokens: {} }));
}

function fakeFetch(providers = [{ id: "gateway", envConfigured: true }]) {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path === "/api/providers") return Response.json({ providers });
    if (path === "/api/integrations") {
      return Response.json({
        integrations: INTEGRATIONS.map((item) => ({ id: item.id, mode: "none", configured: false, oauthAvailable: false })),
      });
    }
    if (path.startsWith("/api/providers/models?")) return Response.json({ models: [{ id: "example/model", name: "Example" }], source: "static" });
    if (path === "/api/workspace") {
      if (options.method === "PUT") return Response.json({ ok: true, storage: "cloud", updatedAt: "2026-11-09T12:00:00.000Z" });
      return Response.json({ storage: "cloud", workspace: null, updatedAt: null });
    }
    if (path === "/api/chats") return Response.json({ chats: [], storage: "account" });
    if (path.startsWith("/api/chats/") && options.method === "PATCH") {
      const parsed = options.body ? JSON.parse(String(options.body)) : {};
      return Response.json({ ok: true, title: parsed.title ?? "Chat" });
    }
    return Response.json({});
  };
}

function app(child) {
  return h(AppSettingsProvider, { userId, accountKind: "vercel" }, h(TooltipProvider, null, child));
}

test("deriveChatTitle cleans markdown markers and trims at word boundary without breaking short text", () => {
  assert.equal(deriveChatTitle("  A useful question  ", "New chat"), "A useful question");
  assert.equal(deriveChatTitle("#   Fix **streaming**   reconnect bug\nwith details", "New chat"), "Fix **streaming** reconnect bug with details");
  assert.equal(deriveChatTitle("   ", "New chat"), "New chat");
  const longText = "Investigate intermittent streaming reconnect failure after manual cancellation on desktop and mobile layouts";
  const derived = deriveChatTitle(longText, "New chat");
  assert.ok(derived.endsWith("…"));
  assert.ok(derived.length <= 72);
  assert.ok(!derived.endsWith(" …"));
  assert.equal(sessionTitle([{ role: "user", parts: [{ type: "text", text: "> Refactor the sidebar filter cleanly" }] }], "New chat"), "Refactor the sidebar filter cleanly");
});

test("language toggle updates AppSettings.t reactively and localizes ConnectivityBanner & NotFoundState", async () => {
  seed({ language: "en" });
  fakeFetch();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
  function Probe() {
    const { t, update } = useAppSettings();
    return h("div", null,
      h("span", { "data-testid": "label" }, t("send")),
      h("button", { type: "button", onClick: () => update({ language: "so" }) }, "Switch SO"),
      h(ConnectivityBanner),
      h(NotFoundState),
    );
  }
  render(app(h(Probe)));
  assert.equal(screen.getByTestId("label").textContent, "Send");
  assert.ok(screen.getByText(/You are offline/));
  assert.ok(screen.getByText("This page does not exist"));

  await userEvent.setup().click(screen.getByRole("button", { name: "Switch SO" }));
  assert.equal(screen.getByTestId("label").textContent, "Dir");
  await waitFor(() => assert.ok(screen.getByText(/Internet-ka ayaa go'an/)));
  assert.ok(screen.getByText("Boggan ma jiro"));
});

test("EmptyState exposes interactive mode pills and provider onboarding banner only when disconnected", async () => {
  seed();
  fakeFetch([{ id: "gateway", envConfigured: false }]);
  const modes = [];
  let settingsOpened = 0;
  const view = render(app(h(PromptInputProvider, null, h(EmptyState, {
    name: "Ali",
    mode: "chat",
    onModeChange: (next) => modes.push(next),
    onOpenSettings: () => { settingsOpened += 1; },
  }))));
  await screen.findByText("Connect a provider to get started");
  await userEvent.setup().click(screen.getByRole("button", { name: "Connect provider" }));
  assert.equal(settingsOpened, 1);

  const coderBtn = screen.getByRole("button", { name: "Coder" });
  assert.equal(coderBtn.getAttribute("aria-pressed"), "false");
  await userEvent.setup().click(coderBtn);
  assert.deepEqual(modes, ["coder"]);

  // Connected gateway hides the onboarding prompt
  view.unmount();
  fakeFetch([{ id: "gateway", envConfigured: true }]);
  render(app(h(PromptInputProvider, null, h(EmptyState, {
    name: "Ali",
    mode: "chat",
    onModeChange: () => {},
    onOpenSettings: () => {},
  }))));
  await waitFor(() => assert.equal(screen.queryByText("Connect a provider to get started"), null));
});

test("Sidebar filters current mode by default, reveals cross-mode history with All modes, and TopBar toggles desktop collapse", async () => {
  const chats = [
    { id: "chat-1", title: "General question", updatedAt: 1000 },
    { id: "coder-1", title: "Fix parser bug", updatedAt: 2000 },
  ];
  seed({ chats });
  fakeFetch();
  window.localStorage.setItem(agentModeStorageKey("vercel", userId, "chat-1"), "chat");
  window.localStorage.setItem(agentModeStorageKey("vercel", userId, "coder-1"), "coder");

  let collapsed = false;
  function Harness() {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    collapsed = isCollapsed;
    return h("div", null,
      h(TopBar, {
        canExport: false,
        desktopCollapsed: isCollapsed,
        mode: "chat",
        onExportChat: () => {},
        onNewChat: () => {},
        onOpenModels: () => {},
        onOpenSettings: () => {},
        onOpenSidebar: () => {},
        onToggleDesktopSidebar: () => setIsCollapsed((prev) => !prev),
        sidebarOpen: false,
      }),
      h(Sidebar, {
        desktopCollapsed: isCollapsed,
        mode: "chat",
        onClose: () => {},
        onNewChat: () => {},
        onOpenSettings: () => {},
        open: false,
      }),
    );
  }

  render(app(h(Harness)));
  assert.ok(screen.getByText("General question"));
  assert.equal(screen.queryByText("Fix parser bug"), null);

  await userEvent.setup().click(screen.getByRole("button", { name: "All modes" }));
  assert.ok(screen.getByText("Fix parser bug"));
  assert.ok(screen.getByText("General question"));

  const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await userEvent.setup().click(toggle);
  assert.equal(collapsed, true);
  assert.ok(screen.getByRole("button", { name: "Expand sidebar" }));
});

test("Composer renders Voice input and Send side-by-side, shows drag-drop overlay, and displays image thumbnails", async () => {
  seed();
  fakeFetch();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:preview-image";
  URL.revokeObjectURL = () => {};
  try {
    render(app(h(TooltipProvider, null, h(PromptInputProvider, null,
      h(ChatComposer, { isBusy: false, isResuming: false, onCancel: () => {}, onSubmit: async () => {} }),
    ))));
    // Both buttons present simultaneously when draft is empty
    const voice = screen.getByRole("button", { name: "Voice input" });
    const send = screen.getByRole("button", { name: "Send" });
    assert.ok(voice);
    assert.equal(send.disabled, true);
    assert.ok(!voice.className.includes("hidden"));

    // Drag overlay triggers on file dragenter and clears on drop with thumbnail preview
    const imgFile = new File(["png"], "screenshot.png", { type: "image/png" });
    fireEvent.dragEnter(document, { dataTransfer: { types: ["Files"], files: [imgFile] } });
    assert.ok(await screen.findByText("Drop files to attach"));
    fireEvent.drop(document, { dataTransfer: { types: ["Files"], files: [imgFile] } });
    await waitFor(() => assert.equal(screen.queryByText("Drop files to attach"), null));
    const thumb = await screen.findByAltText("screenshot.png");
    assert.equal(thumb.getAttribute("src"), "blob:preview-image");
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("AgentArtifactCard and CoderWorkspace support clipboard copy, line numbers, and accessible discard dialog", async () => {
  const copied = [];
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text) => { copied.push(text); } },
  });

  render(h(AgentArtifactCard, { artifact: { filename: "summary.md", description: "Notes", content: "# Hello" } }));
  await user.click(screen.getByRole("button", { name: "Copy: summary.md" }));
  await waitFor(() => assert.deepEqual(copied, ["# Hello"]));
  cleanup();

  const makeDocument = (content, fill) => ({ kind: "coder-workspace-read", version: 1, path: "src/a.ts", content, sha256: fill.repeat(64), bytes: content.length, totalLines: 2, truncated: false });
  const snapshot = {
    kind: "coder-workspace-snapshot", version: 1, workspaceRoot: "/workspace", files: [{ path: "src/a.ts" }], filesTruncated: false,
    repository: { isRepository: false, changes: [], changesTruncated: false }, diff: "", diffTruncated: false, warnings: [], capturedAt: "2026-11-04T12:00:00.000Z",
  };
  const base = { snapshot, snapshotStale: false, commands: [], diagnostics: [] };
  const props = { isBusy: false, mobileVisible: true, onCommand: () => {}, onReviewApprovals: () => {} };
  const view = render(h(CoderWorkspace, { ...props, projection: { ...base, documents: { "src/a.ts": makeDocument("line1\nline2", "a") } } }));
  fireEvent.click(screen.getByRole("button", { name: "a.ts" }));
  fireEvent.change(screen.getByLabelText("Edit src/a.ts"), { target: { value: "mine\n" } });

  await user.click(screen.getByRole("button", { name: "Copy file" }));
  await waitFor(() => assert.equal(copied.at(-1), "mine\n"));

  view.rerender(h(CoderWorkspace, { ...props, projection: { ...base, documents: { "src/a.ts": makeDocument("remote\n", "b") } } }));
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  const dialog = await screen.findByRole("dialog", { name: "Discard local draft?" });
  await user.click(within(dialog).getByRole("button", { name: "Discard draft" }));
  await waitFor(() => assert.equal(screen.getByLabelText("Edit src/a.ts").value, "remote\n"));
});

test("WorkspacePanel validates and imports workspace JSON files safely", async () => {
  seed();
  fakeFetch();
  render(app(h(WorkspacePanel)));
  const input = await screen.findByLabelText("Import workspace JSON", { selector: "input" });

  // Invalid JSON structure rejected cleanly
  const badFile = new File([JSON.stringify({ version: 99 })], "bad.json", { type: "application/json" });
  Object.defineProperty(badFile, "text", { value: async () => JSON.stringify({ version: 99 }) });
  fireEvent.change(input, { target: { files: [badFile] } });
  await screen.findByText(/Invalid workspace JSON file/);

  // Valid workspace JSON imports cleanly
  const validPayload = {
    version: 1,
    memoryEnabled: true,
    projects: [{ id: "proj-1", name: "Imported Project", instructions: "Be thorough", chatIds: [] }],
    notes: [],
    maxSteps: 8,
  };
  const goodFile = new File([JSON.stringify(validPayload)], "good.json", { type: "application/json" });
  Object.defineProperty(goodFile, "text", { value: async () => JSON.stringify(validPayload) });
  fireEvent.change(input, { target: { files: [goodFile] } });
  await screen.findByText("Workspace imported.");
  assert.ok(screen.getByText("Imported Project"));
});

test("AgentChat supports Regenerate, inline Edit & Resend, Retry on error, Ctrl+B sidebar collapse, and resizable split pane", async () => {
  const { registerHooks } = await import("node:module");
  const mockModule = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
  const eveReactMock = `export function useEveAgent() {
    const agent = globalThis.__auditAgent;
    const data = agent?.data ?? {};
    return {
      ...agent,
      messages: agent?.messages ?? data.messages ?? [],
      events: agent?.events ?? [],
      view: agent?.view ?? {},
      error: agent?.error,
      status: ["streaming", "submitted", "busy"].includes(agent?.status) ? "busy" : agent?.status === "resuming" ? "resuming" : "idle",
    };
  }`;
  const eveEventsMock = `export function activeTurn() { return undefined; }
    export function turn() { return undefined; }
    export function interactions() { return []; }
    export function signInEnding(outcome) { return outcome === "accepted" ? "connected" : "failed"; }`;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "eve/react") return mockModule(eveReactMock);
      if (specifier === "eve/events") return mockModule(eveEventsMock);
      return nextResolve(specifier, context);
    },
  });
  try {
    const { AgentChat } = await import("../components/chat/agent-chat.tsx");
    seed({ chatProofs: { "owned-audit": "proof-token" } });
    window.localStorage.setItem(agentModeStorageKey("vercel", userId, "owned-audit"), "coder");
    fakeFetch();
    const sentPayloads = [];
    globalThis.__auditAgent = {
      status: "ready",
      events: [],
      data: {
        inputs: {},
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "Explain TypeScript" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "TypeScript adds static types." }] },
        ],
      },
      error: new Error("Temporary failure"),
      send: async (payload) => { sentPayloads.push(payload); },
      respond: async () => {},
      cancel: async () => {},
    };

    const account = { id: userId, kind: "vercel", name: "Test", email: "test@example.test" };
    render(app(h(AgentChat, { account, initialMode: "coder", sessionId: "owned-audit" })));

    // Regenerate last assistant response
    const regen = await screen.findByRole("button", { name: "Regenerate" });
    await userEvent.setup().click(regen);
    await waitFor(() => assert.equal(sentPayloads.at(-1), "Explain TypeScript"));

    // Inline Edit & Resend
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit" }));
    const editBox = await screen.findByLabelText("Edit message");
    fireEvent.change(editBox, { target: { value: "Explain TypeScript generics" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save & send" }));
    await waitFor(() => assert.equal(sentPayloads.at(-1), "Explain TypeScript generics"));

    // Retry button on ErrorMessage
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => assert.equal(sentPayloads.at(-1), "Explain TypeScript"));

    // Ctrl+B toggles desktop sidebar collapse
    const collapseBtn = screen.getByRole("button", { name: "Collapse sidebar" });
    assert.equal(collapseBtn.getAttribute("aria-expanded"), "true");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Expand sidebar" })));

    // Resizable separator adjusts split percentage on keyboard arrows + workspace expand works
    const separator = screen.getByRole("separator", { name: "Resize conversation and workspace split" });
    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    assert.equal(Number(separator.getAttribute("aria-valuenow")), before + 3);
    await userEvent.setup().click(screen.getByRole("button", { name: "Expand workspace" }));
    assert.equal(screen.queryByRole("separator"), null);
    await userEvent.setup().click(screen.getByRole("button", { name: "Restore split view" }));
    assert.ok(screen.getByRole("separator"));
  } finally {
    hook.deregister();
    delete globalThis.__auditAgent;
  }
});
