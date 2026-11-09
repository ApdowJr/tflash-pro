import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// Real React components; a local DOM; no network. These tests cover the
// recovery surfaces that keep a failed panel or page from stranding a reader.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/",
  pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect", "History", "Location", "location", "history"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.self = dom.window;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.PointerEvent = dom.window.MouseEvent;
globalThis.PointerEvent = dom.window.MouseEvent;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
register();

const React = await import("react");
const { render, screen, waitFor, cleanup, fireEvent } = await import("@testing-library/react");
const { LazyPanel } = await import("../components/app/lazy-panel.tsx");
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { translate } = await import("../components/settings/i18n.ts");

const h = React.createElement;
const realError = console.error;

afterEach(() => {
  cleanup();
  console.error = realError;
});

function App({ children, userId = "panel-test" }) {
  return h(AppSettingsProvider, { userId, accountKind: "supabase" }, children);
}

test("a code-split panel renders its fallback and then the panel itself", async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { default: ({ label }) => h("p", null, `panel:${label}`) };
  };
  render(h(App, null, h(LazyPanel, {
    load,
    label: "Coder",
    fallback: h("p", null, "loading"),
    failure: () => h("p", null, "failed"),
    render: (Panel) => h(Panel, { label: "ready" }),
  })));
  assert.ok(screen.getByText("loading"));
  await waitFor(() => assert.ok(screen.getByText("panel:ready")));
  assert.equal(loads, 1);
  assert.equal(screen.queryByText("failed"), null);
});

test("an unloadable panel fails inside its own column and retries on request", async () => {
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    // First attempt behaves like a stale deployment: the chunk is gone.
    if (attempts === 1) throw new Error("Failed to fetch dynamically imported module");
    return { default: () => h("p", null, "recovered panel") };
  };
  const consoleErrors = [];
  console.error = (...args) => { consoleErrors.push(args.map(String).join(" ")); };
  render(h(App, null, h("div", null,
    h("p", null, "conversation stays here"),
    h(LazyPanel, {
      load,
      label: "Research",
      fallback: h("p", null, "loading"),
      failure: (retry) => h("div", { role: "alert" },
        h("p", null, "panel failed"),
        h("button", { onClick: retry, type: "button" }, "retry"),
      ),
      render: (Panel) => h(Panel),
    }),
  )));
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  // The rest of the screen is untouched.
  assert.ok(screen.getByText("conversation stays here"));
  assert.equal(attempts, 1);
  fireEvent.click(screen.getByText("retry"));
  await waitFor(() => assert.ok(screen.getByText("recovered panel")));
  assert.equal(attempts, 2);
  assert.ok(consoleErrors.some((entry) => entry.includes("workspace panel failed")));
});

test("the route error screen retries once automatically and offers a reload", async () => {
  const AppError = (await import("../app/error.tsx")).default;
  const resets = [];
  const consoleErrors = [];
  console.error = (...args) => { consoleErrors.push(args.map(String).join(" ")); };
  const error = Object.assign(new Error("render exploded"), { digest: "d1gest" });
  const view = render(h(AppError, { error, reset: () => resets.push(Date.now()) }));
  // The copy follows the merged EN/SO language setting; English is the default.
  assert.ok(screen.getByText("This screen could not load"));
  assert.ok(screen.getByText("digest: d1gest"));
  assert.ok(screen.getByRole("button", { name: "Reload" }));
  assert.ok(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => assert.equal(resets.length, 1), { timeout: 2_000 });
  // Re-rendering with the same instance must not schedule another loop.
  view.rerender(h(AppError, { error: Object.assign(new Error("again"), { digest: "d1gest" }), reset: () => resets.push(Date.now()) }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(resets.length, 1);
  assert.ok(consoleErrors.some((entry) => entry.includes("[tflash] route error")));
});

test("panel recovery copy exists in both languages", () => {
  for (const key of ["workspacePanelFailed", "workspacePanelReload", "retry"]) {
    assert.equal(typeof translate("en", key), "string");
    assert.equal(typeof translate("so", key), "string");
    assert.ok(translate("en", key).length > 0);
    assert.ok(translate("so", key).length > 0);
  }
  assert.notEqual(translate("en", "workspacePanelFailed"), translate("so", "workspacePanelFailed"));
});
