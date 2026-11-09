import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// A code-split workspace chunk that cannot be downloaded must not take the
// conversation with it. This renders the real chat shell with a workspace
// module that throws while evaluating, and asserts the reader keeps the
// composer, the conversation frame and an in-place recovery action.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/",
  pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect", "History", "Location", "location", "history", "self"]) {
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

const { registerHooks } = await import("node:module");
const failingWorkspace = `data:text/javascript,${encodeURIComponent(
  'throw new Error("Failed to fetch dynamically imported module: coder-workspace");',
)}`;
let workspaceImports = 0;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/components/coder/coder-workspace") {
      workspaceImports += 1;
      return { url: failingWorkspace, shortCircuit: true };
    }
    if (specifier === "eve/react") {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export function useEveAgent() {
            const agent = globalThis.__chatMock;
            const data = agent?.data ?? {};
            return {
              ...agent,
              messages: agent?.messages ?? data.messages ?? [],
              events: agent?.events ?? [],
              view: agent?.view ?? { __legacy: data },
              error: agent?.error,
              status: agent?.status ?? "idle",
            };
          }
        `)}`,
        shortCircuit: true,
      };
    }
    if (specifier === "eve/events") {
      return {
        url: `data:text/javascript,${encodeURIComponent(`
          export function activeTurn() { return undefined; }
          export function turn() { return undefined; }
          export function interactions() { return []; }
          export function signInEnding() { return "failed"; }
        `)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const React = await import("react");
const { render, screen, waitFor, cleanup } = await import("@testing-library/react");
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");
const { AgentChat } = await import("../components/chat/agent-chat.tsx");
const { translate } = await import("../components/settings/i18n.ts");

const h = React.createElement;
const realFetch = globalThis.fetch;
const realError = console.error;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  console.error = realError;
});

test("a failed workspace chunk leaves the conversation and composer usable", async () => {
  const consoleErrors = [];
  console.error = (...args) => { consoleErrors.push(args.map(String).join(" ")); };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/providers")) return Response.json({ providers: [] });
    if (url.includes("/api/workspace")) return Response.json({ storage: "browser" });
    if (url.includes("/api/chats") && (init?.method ?? "GET") === "POST") {
      return Response.json({ sessionId: "panel-session", proof: "panel-proof" });
    }
    if (url.includes("/api/chats")) return Response.json({ chats: [] });
    return Response.json({});
  };
  globalThis.__chatMock = {
    status: "ready",
    messages: [],
    events: [],
    data: { messages: [], inputs: {} },
    send: async () => {},
    respond: async () => {},
    cancel: async () => {},
    resume: async () => {},
    session: { sessionId: "panel-session" },
  };

  render(h(AppSettingsProvider, { userId: "chunk-test", accountKind: "supabase" },
    h(TooltipProvider, null,
      h(AgentChat, {
        account: { id: "chunk-test", kind: "supabase", name: "Test", email: "test@example.test" },
        initialMode: "coder",
      }))));

  // The panel explains the failure inside its own column.
  await waitFor(() => assert.ok(screen.getAllByText(translate("en", "workspacePanelFailed")).length > 0), { timeout: 5_000 });
  assert.ok(screen.getAllByText(translate("en", "retry")).length > 0);
  assert.ok(screen.getAllByText(translate("en", "workspacePanelReload")).length > 0);

  // The conversation itself is still mounted and usable.
  const composer = await screen.findByPlaceholderText(translate("en", "coderPlaceholder"));
  assert.equal(composer.hasAttribute("disabled"), false);
  assert.ok(workspaceImports >= 1);
  assert.ok(consoleErrors.some((entry) => entry.includes("workspace panel failed")));
});
