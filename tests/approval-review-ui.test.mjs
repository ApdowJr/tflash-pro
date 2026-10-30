import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tflash.example.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
register();
const React = await import("react");
const { render, screen, fireEvent, cleanup, within, waitFor } = await import("@testing-library/react");
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { InputRequestActions } = await import("../components/chat/agent-message.tsx");
const h = React.createElement;

function part(id, command, extra = {}) {
  return {
    type: "dynamic-tool", toolName: "bash", toolCallId: id, state: "approval-requested",
    input: { command }, ...extra,
    toolMetadata: { eve: { inputRequest: { requestId: id, kind: "tool-approval", prompt: "Run shell command?",
      options: [{ id: "approve", label: "Approve" }, { id: "cancel", label: "Cancel" }] }, ...extra.eve } },
  };
}
function ui(children) {
  return h(AppSettingsProvider, { userId: "user", accountKind: "supabase" }, children);
}
afterEach(() => { cleanup(); window.localStorage.clear(); });

test("review presents the complete action and a single-call decision", async () => {
  const responses = [];
  const command = 'printf "hello"; echo "second line"\nls -la';
  render(ui(h(InputRequestActions, { part: part("one", command), canRespond: () => true, onInputResponses: (r) => responses.push(r) })));
  assert.ok(screen.getByText("Approval required"));
  assert.ok(screen.getByText("Run a shell command in the agent sandbox"));
  assert.match(screen.getByText(/Approval applies only/).textContent, /Future gated actions ask again/);
  const summary = screen.getByText("View complete action and arguments");
  assert.equal(summary.parentElement.open, false);
  fireEvent.click(summary);
  assert.equal(summary.parentElement.open, true);
  assert.equal(JSON.parse(summary.parentElement.querySelector("code").textContent).command, command);
  fireEvent.click(screen.getByRole("button", { name: "Approve once" }));
  await waitFor(() => assert.deepEqual(responses, [[{ requestId: "one", optionId: "approve" }]]));
  assert.equal(screen.queryByRole("button", { name: /always approve|full permissions/i }), null);
});

test("concurrent prompts stay independent and closed prompts cannot be answered", async () => {
  const responses = [];
  render(ui(h("div", null, ["a", "b", "closed"].map((id) => h("section", { key: id, "aria-label": id },
    h(InputRequestActions, { part: part(id, `echo ${id}`), canRespond: () => id !== "closed", onInputResponses: (r) => responses.push(r) }))))));
  fireEvent.click(within(screen.getByLabelText("b")).getByRole("button", { name: "Deny" }));
  await waitFor(() => assert.deepEqual(responses, [[{ requestId: "b", optionId: "cancel" }]]));
  assert.equal(within(screen.getByLabelText("closed")).getByRole("button", { name: "Approve once" }).disabled, true);
});

test("settled approvals cannot be submitted again", () => {
  const p = part("done", "pwd", { approval: { approved: true } });
  render(ui(h(InputRequestActions, { part: p, canRespond: () => true, onInputResponses: () => assert.fail("settled") })));
  assert.ok(screen.getByText(/Approved/));
  assert.equal(screen.queryByRole("button", { name: "Approve once" }), null);
});


test("a pending response cannot be submitted twice and a failed response can be retried", async () => {
  let reject;
  let count = 0;
  const pending = new Promise((_, no) => { reject = no; });
  render(ui(h(InputRequestActions, { part: part("one", "pwd"), canRespond: () => true,
    onInputResponses: () => { count++; return count === 1 ? pending : Promise.resolve(); } })));
  const approve = screen.getByRole("button", { name: "Approve once" });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => assert.equal(count, 1));
  assert.equal(approve.disabled, true);
  await React.act(async () => { reject(new Error("offline")); try { await pending; } catch {} });
  await screen.findByRole("alert");
  assert.equal(approve.disabled, false);
  fireEvent.click(approve);
  await waitFor(() => assert.equal(count, 2));
});
