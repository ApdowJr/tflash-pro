import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { register } from "tsx/esm/api";

// Exercise the real controls with mocked browser speech APIs. No audio leaves
// this process; live browser engines and Somali voice availability vary.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tflash.example.test/",
  pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "File", "FileReader", "Blob", "DOMRect"]) {
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

const React = await import("react");
const { render, screen, waitFor, cleanup, within } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { AppSettingsProvider } = await import("../components/settings/app-settings.tsx");
const { PromptInputProvider, usePromptInputController } = await import("../components/ai-elements/prompt-input.tsx");
const { TooltipProvider } = await import("../components/ui/tooltip.tsx");
const { ChatComposer } = await import("../components/chat/chat-composer.tsx");
const { VoiceOutputButton } = await import("../components/chat/voice-output.tsx");
const { splitSpeechText, voiceMatchesLanguage } = await import("../lib/browser-speech.ts");
const h = React.createElement;
const realFetch = globalThis.fetch;

function seed(language = "en") {
  window.localStorage.clear();
  window.localStorage.setItem("tflash:language", language);
  window.localStorage.setItem("tflash:settings:v1:voice-test", JSON.stringify({ language }));
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path === "/api/providers") return Response.json({ providers: [] });
    if (path === "/api/integrations") return Response.json({ integrations: [] });
    if (path === "/api/chats") return Response.json({ chats: [], storage: "account" });
    throw new Error(`Unexpected request: ${path}`);
  };
}

function app(child) {
  return h(AppSettingsProvider, { userId: "voice-test", accountKind: "vercel" }, h(TooltipProvider, null, child));
}

function composer(onSubmit = async () => {}, probe = null, extra = {}) {
  return app(h(PromptInputProvider, null,
    probe,
    h(ChatComposer, { isBusy: false, isResuming: false, onCancel() {}, onSubmit, ...extra }),
  ));
}

function mockRecognition({ prefixed = false, autoStart = true } = {}) {
  const instances = [];
  class Recognition {
    constructor() { this.started = 0; this.stopped = 0; this.aborted = 0; instances.push(this); }
    start() { this.started += 1; if (autoStart) this.onstart?.(); }
    stop() { this.stopped += 1; }
    abort() { this.aborted += 1; }
    results(entries) {
      this.onresult?.({ results: entries.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) });
    }
    end() { this.onend?.(); }
    fail(error) { this.onerror?.({ error }); }
  }
  if (prefixed) window.webkitSpeechRecognition = Recognition;
  else window.SpeechRecognition = Recognition;
  return instances;
}

function mockSynthesis(initialVoices = []) {
  const spoken = [];
  const listeners = new Set();
  const state = { voices: initialVoices, cancellations: 0 };
  const engine = {
    getVoices: () => state.voices,
    addEventListener: (type, callback) => { if (type === "voiceschanged") listeners.add(callback); },
    removeEventListener: (type, callback) => { if (type === "voiceschanged") listeners.delete(callback); },
    speak: (utterance) => { spoken.push(utterance); },
    cancel: () => { state.cancellations += 1; },
  };
  class Utterance { constructor(text) { this.text = text; } }
  window.speechSynthesis = engine;
  window.SpeechSynthesisUtterance = Utterance;
  return { engine, spoken, state, changed: () => { for (const callback of listeners) callback(); } };
}

const voice = (lang, name) => ({ lang, name, voiceURI: name, localService: true });

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.localStorage.clear();
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
  delete window.isSecureContext;
  delete document.visibilityState;
  delete globalThis.__voiceAgent;
});

test("one tap starts dictation immediately, appends final words once, and never sends automatically", async () => {
  seed("so");
  const recognizers = mockRecognition();
  const sent = [];
  render(composer(async (message) => sent.push(message)));
  const user = userEvent.setup();
  const textarea = await screen.findByPlaceholderText("Su'aal weydii ama fayl soo geli…");
  const mic = screen.getByRole("button", { name: "Cod ku qor" });
  await user.click(mic);
  const recognition = recognizers[0];
  assert.ok(recognition, "microphone tap starts recognition without another prompt");
  assert.equal(recognition.started, 1);
  assert.equal(recognition.lang, "", "browser default locale is used without a language picker");
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
  await React.act(async () => {
    recognition.results([["Salaan", true]]);
    recognition.results([["Salaan", true], ["sidee tahay", true]]);
  });
  assert.equal(textarea.value, "Salaan sidee tahay");
  assert.equal(sent.length, 0, "dictation must never send automatically");
  const stop = screen.getByRole("button", { name: "Jooji dhegeysiga" });
  await user.click(stop);
  assert.equal(recognition.stopped, 1);
  await React.act(async () => recognition.end());
  assert.ok(screen.getByRole("button", { name: "Dir" }));
  assert.equal(textarea.value, "Salaan sidee tahay");
  await user.click(screen.getByRole("button", { name: "Dir" }));
  await waitFor(() => assert.equal(sent.length, 1));
  assert.equal(sent[0].text, "Salaan sidee tahay");
});

test("composer shows mic when empty and send only after text is entered", async () => {
  seed();
  render(composer());
  const user = userEvent.setup();
  assert.ok(screen.getByRole("button", { name: "Voice input" }));
  assert.equal(screen.queryByRole("button", { name: "Send" }), null);
  const textarea = screen.getByPlaceholderText("Ask a question or bring in a file…");
  await user.type(textarea, "Hello");
  assert.ok(screen.getByRole("button", { name: "Send" }));
  assert.equal(screen.queryByRole("button", { name: "Voice input" }), null);
});

test("dictation drops stale callbacks after the composer unmounts", async () => {
  seed();
  const recognizers = mockRecognition({ prefixed: true });
  const view = render(composer());
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Voice input" }));
  const recognition = recognizers[0];
  const staleResult = recognition.onresult;
  view.unmount();
  assert.equal(recognition.aborted, 1);
  await React.act(async () => staleResult({ results: [{ 0: { transcript: "stale words" }, isFinal: true }] }));
});

test("microphone errors and unsupported browsers are visible, with no silent retry", async () => {
  seed();
  const recognizers = mockRecognition();
  render(composer());
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Voice input" }));
  await React.act(async () => recognizers[0].fail("not-allowed"));
  assert.match(screen.getByRole("alert").textContent, /access was denied/);
  assert.equal(recognizers[0].aborted, 1);
  assert.equal(recognizers.length, 1);
  await user.click(screen.getByRole("button", { name: "Voice input" }));
  await React.act(async () => recognizers[1].fail("language-not-supported"));
  assert.match(screen.getByRole("alert").textContent, /does not support the selected language/);
  delete window.SpeechRecognition;
  await user.click(screen.getByRole("button", { name: "Voice input" }));
  assert.match(screen.getByRole("alert").textContent, /not available in this browser/);
});

test("insecure contexts do not start dictation; unmounting aborts capture", async () => {
  seed();
  const recognizers = mockRecognition();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  const view = render(composer());
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Voice input" }));
  assert.match(screen.getByRole("alert").textContent, /secure connection/);
  assert.equal(recognizers.length, 0);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  await user.click(screen.getByRole("button", { name: "Voice input" }));
  assert.equal(recognizers.length, 1);
  view.unmount();
  assert.equal(recognizers[0].aborted, 1);
});

test("late start callbacks do not undo stop, and hiding the page aborts capture", async () => {
  seed();
  const recognizers = mockRecognition({ autoStart: false });
  render(composer());
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Voice input" }));
  const recognition = recognizers[0];
  assert.ok(screen.getByRole("status"));
  await user.click(screen.getByRole("button", { name: "Stop listening" }));
  await React.act(async () => recognition.onstart());
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await React.act(async () => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(recognition.aborted, 1);
  assert.match(screen.getByRole("alert").textContent, /page was hidden/);
});

test("read aloud refuses an unmatched Somali voice and updates when voices load", async () => {
  seed("so");
  const output = mockSynthesis([voice("en-US", "English voice")]);
  render(app(h(VoiceOutputButton, { text: "Salaan dunida" })));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Dhegeyso" }));
  const dialog = await screen.findByRole("dialog", { name: "Jawaabta cod ku akhri" });
  assert.match(dialog.textContent, /adeegga codka ee aad doorato/);
  assert.match(dialog.textContent, /Luqaddan cod looma helin/);
  assert.equal(within(dialog).getByRole("button", { name: "Daar" }).disabled, true);
  assert.equal(output.spoken.length, 0);
  await user.selectOptions(within(dialog).getByLabelText("Luqadda hadalka"), "en");
  assert.equal(within(dialog).getByLabelText("Codka").value, "English voice");
  assert.equal(within(dialog).getByRole("button", { name: "Daar" }).disabled, false);
  assert.equal(output.spoken.length, 0, "changing language must not start playback");
  await user.selectOptions(within(dialog).getByLabelText("Luqadda hadalka"), "so");
  output.state.voices = [voice("en-US", "English voice"), voice("so-SO", "Somali voice")];
  await React.act(async () => output.changed());
  assert.equal(within(dialog).getByRole("button", { name: "Daar" }).disabled, false);
  await user.click(within(dialog).getByRole("button", { name: "Daar" }));
  assert.equal(output.spoken.length, 1);
  assert.equal(output.spoken[0].text, "Salaan dunida");
  assert.equal(output.spoken[0].lang, "so-SO");
  assert.equal(output.spoken[0].voice.name, "Somali voice");
  assert.equal(within(dialog).getByLabelText("Luqadda hadalka").disabled, true);
  await React.act(async () => output.spoken[0].onend());
  assert.equal(within(dialog).getByLabelText("Luqadda hadalka").disabled, false);
});

test("playback chunks long responses, stops on close, and ignores late end callbacks", async () => {
  seed();
  const output = mockSynthesis([voice("en-US", "English voice")]);
  const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
  const view = render(app(h(VoiceOutputButton, { text })));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Listen" }));
  const dialog = await screen.findByRole("dialog", { name: "Read response aloud" });
  await user.click(within(dialog).getByRole("button", { name: "Play" }));
  assert.equal(output.spoken.length, 1);
  await React.act(async () => output.spoken[0].onend());
  assert.equal(output.spoken.length, 2);
  const late = output.spoken[1].onend;
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  assert.equal(output.state.cancellations, 1);
  await React.act(async () => late());
  assert.equal(output.spoken.length, 2, "a cancelled job must not queue another chunk");
  await user.click(screen.getByRole("button", { name: "Listen" }));
  const reopened = await screen.findByRole("dialog", { name: "Read response aloud" });
  await user.click(within(reopened).getByRole("button", { name: "Play" }));
  view.unmount();
  assert.equal(output.state.cancellations, 2);
});

test("read aloud explains missing browser support and playback failures", async () => {
  seed();
  const output = mockSynthesis([voice("en-GB", "English voice")]);
  render(app(h(VoiceOutputButton, { text: "A response" })));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Listen" }));
  let dialog = await screen.findByRole("dialog", { name: "Read response aloud" });
  await user.click(within(dialog).getByRole("button", { name: "Play" }));
  await React.act(async () => output.spoken[0].onerror({ error: "synthesis-failed" }));
  assert.match(within(dialog).getByRole("alert").textContent, /Playback failed/);
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
  await user.click(screen.getByRole("button", { name: "Listen" }));
  dialog = await screen.findByRole("dialog", { name: "Read response aloud" });
  assert.match(dialog.textContent, /not available in this browser/);
  assert.equal(within(dialog).getByRole("button", { name: "Play" }).disabled, true);
});

test("the real chat offers playback for completed assistant text only, not tool or reasoning data", async () => {
  const { registerHooks } = await import("node:module");
  const mockModule = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
  const eveReactMock = `export function useEveAgent() {
    const agent = globalThis.__voiceAgent;
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
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "eve/react") return mockModule(eveReactMock);
    if (specifier === "eve/events") return mockModule(eveEventsMock);
    return nextResolve(specifier, context);
  } });
  try {
    const { AgentChat } = await import("../components/chat/agent-chat.tsx");
    seed();
    window.localStorage.setItem("tflash:settings:v1:voice-test", JSON.stringify({ language: "en", chatProofs: { "owned-chat": "test-proof" } }));
    const output = mockSynthesis([voice("en-US", "English voice")]);
    globalThis.__voiceAgent = {
      status: "ready", events: [],
      data: { inputs: {}, messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "User question" }] },
        { id: "assistant-1", role: "assistant", parts: [
          { type: "text", text: "First public answer." },
          { type: "reasoning", text: "Private reasoning", state: "done" },
          { type: "dynamic-tool", toolName: "example", toolCallId: "call-1", state: "output-available", input: { secret: "tool input" }, output: "tool output" },
          { type: "text", text: "Second public answer." },
        ] },
      ] },
      send: async () => {}, respond: async () => {}, cancel: async () => {},
    };
    const account = { id: "voice-test", kind: "vercel", name: "Test", email: "test@example.test" };
    const view = render(app(h(AgentChat, { account, sessionId: "owned-chat" })));
    const user = userEvent.setup();
    const listen = await screen.findByRole("button", { name: "Listen" });
    assert.equal(screen.getAllByRole("button", { name: "Listen" }).length, 1);
    await user.click(listen);
    const dialog = await screen.findByRole("dialog", { name: "Read response aloud" });
    await user.click(within(dialog).getByRole("button", { name: "Play" }));
    assert.equal(output.spoken[0].text, "First public answer.\n\nSecond public answer.");
    assert.doesNotMatch(output.spoken[0].text, /User question|Private reasoning|tool input|tool output/);
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    globalThis.__voiceAgent.status = "busy";
    view.rerender(app(h(AgentChat, { account, sessionId: "owned-chat" })));
    assert.equal(screen.getByRole("button", { name: "Listen" }).disabled, true);
  } finally {
    hook.deregister();
  }
});

test("language matching and speech chunking preserve text without splitting surrogate pairs", () => {
  assert.equal(voiceMatchesLanguage(voice("SO_so", "somali"), "so"), true);
  assert.equal(voiceMatchesLanguage(voice("som-ET", "different language"), "so"), false);
  assert.equal(voiceMatchesLanguage(voice("en-US", "english"), "so"), false);
  const longWord = `ab${"🐈".repeat(60)}cd`;
  const chunks = splitSpeechText(longWord, 11);
  assert.equal(chunks.join(""), longWord);
  assert.ok(chunks.every((chunk) => chunk.length <= 11));
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
  const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
  assert.equal(splitSpeechText(words, 40).join(" "), words);
  assert.deepEqual(splitSpeechText("   "), []);
});
