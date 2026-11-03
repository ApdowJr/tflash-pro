import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tflash.example.test/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
register();
const React = await import("react");
const { render, screen, fireEvent, cleanup, within, waitFor } = await import("@testing-library/react");
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { AgentMessage } = await import("../components/chat/agent-message.tsx");
const h = React.createElement;

function interaction(id, extra = {}) {
  return {
    interactionId: id,
    turnId: "turn",
    stepIndex: 0,
    request: {
      kind: "approval",
      prompt: "Run shell command?",
      options: [{ id: "approve", label: "Approve" }, { id: "deny", label: "Deny" }],
    },
    status: "open",
    ...extra,
  };
}

function part(id, command, extra = {}) {
  const { interaction: settled, ...rest } = extra;
  return {
    type: "tool", kind: "tool", name: "bash", callId: id, label: "Bash",
    stepIndex: 0, state: settled === undefined ? "approval" : "completed",
    input: { command }, interaction: interaction(id, settled),
    ...rest,
  };
}

function message(value) {
  return { id: `message-${value.callId}`, role: "assistant", parts: [value] };
}

function ui(value, { canRespond = () => true, onInputResponses = () => {} } = {}) {
  const child = value?.role ? h(AgentMessage, { message: value, canRespond, onInputResponses, questionsFor: () => [] }) : value;
  return h(AppSettingsProvider, { userId: "user", accountKind: "supabase" }, child);
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

test("review presents the complete action and a single-call decision", async () => {
  const responses = [];
  const command = 'printf "hello"; echo "second line"\nls -la';
  render(ui(message(part("one", command)), { onInputResponses: (r) => responses.push(r) }));
  assert.ok(screen.getByText("Approval required"));
  assert.ok(screen.getByText("Run a shell command in the agent sandbox"));
  assert.match(screen.getByText(/Approval applies only/).textContent, /Future gated actions ask again/);
  const summary = screen.getByText("View complete action and arguments");
  assert.equal(summary.parentElement.open, false);
  fireEvent.click(summary);
  assert.equal(summary.parentElement.open, true);
  assert.equal(JSON.parse(summary.parentElement.querySelector("code").textContent).command, command);
  fireEvent.click(screen.getByRole("button", { name: "Approve once" }));
  await waitFor(() => assert.deepEqual(responses, [[{ interactionId: "one", optionId: "approve" }]]));
  assert.equal(screen.queryByRole("button", { name: /always approve|full permissions/i }), null);
});

test("concurrent prompts stay independent and closed prompts cannot be answered", async () => {
  const responses = [];
  const sections = ["a", "b", "closed"].map((id) => h("section", { key: id, "aria-label": id },
    h(AgentMessage, {
      message: message(part(id, `echo ${id}`)),
      canRespond: () => id !== "closed",
      onInputResponses: (r) => responses.push(r),
      questionsFor: () => [],
    })));
  render(ui(h("div", null, sections)));
  fireEvent.click(within(screen.getByLabelText("b")).getByRole("button", { name: "Deny" }));
  await waitFor(() => assert.deepEqual(responses, [[{ interactionId: "b", optionId: "deny" }]]));
  assert.equal(within(screen.getByLabelText("closed")).getByRole("button", { name: "Approve once" }).disabled, true);
});

test("settled approvals cannot be submitted again", () => {
  const p = part("done", "pwd", { interaction: { status: "settled", outcome: "accepted" } });
  render(ui(message(p), { onInputResponses: () => assert.fail("settled") }));
  assert.ok(screen.getByText(/Approved/));
  assert.equal(screen.queryByRole("button", { name: "Approve once" }), null);
});


test("a pending response cannot be submitted twice and a failed response can be retried", async () => {
  let reject;
  let count = 0;
  const pending = new Promise((_, no) => { reject = no; });
  render(ui(message(part("one", "pwd")), {
    onInputResponses: () => { count++; return count === 1 ? pending : Promise.resolve(); },
  }));
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
