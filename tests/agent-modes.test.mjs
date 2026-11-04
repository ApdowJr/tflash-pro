import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_MODES, agentModeContext, agentModeStorageKey, parseAgentMode } from "../lib/agent-modes.ts";

test("three modes have distinct operational instructions and bilingual labels", () => {
  assert.deepEqual(AGENT_MODES.map((mode) => mode.id), ["chat", "coder", "research"]);
  assert.equal(new Set(AGENT_MODES.map((mode) => mode.instruction)).size, 3);
  for (const mode of AGENT_MODES) {
    assert.ok(mode.label.en && mode.label.so && mode.hint.en && mode.hint.so);
    assert.ok(agentModeContext(mode.id, "en").includes(mode.instruction));
    assert.ok(agentModeContext(mode.id, "so").includes("Somali"));
  }
});

test("mode parsing fails closed to Chat and storage keys isolate account and conversation", () => {
  for (const value of [null, undefined, "", "admin", { mode: "coder" }]) assert.equal(parseAgentMode(value), "chat");
  assert.equal(parseAgentMode("coder"), "coder");
  assert.equal(parseAgentMode("research"), "research");
  assert.notEqual(agentModeStorageKey("supabase", "user-a", "chat-1"), agentModeStorageKey("supabase", "user-b", "chat-1"));
  assert.notEqual(agentModeStorageKey("supabase", "user-a", "chat-1"), agentModeStorageKey("vercel", "user-a", "chat-1"));
  assert.notEqual(agentModeStorageKey("supabase", "user-a", "chat-1"), agentModeStorageKey("supabase", "user-a", "chat-2"));
});

test("Coder and Research instructions preserve approval boundaries and truthful evidence", () => {
  const coder = agentModeContext("coder", "en");
  assert.match(coder, /actual connected repository/);
  assert.match(coder, /Never say a file was changed/);
  assert.match(coder, /approvals/);
  const research = agentModeContext("research", "so");
  assert.match(research, /search results, snippets, and model knowledge as leads only/);
  assert.match(research, /do not claim an unread page was verified/);
  assert.match(research, /receipt-backed citations/);
  assert.match(research, /Somali/);
  assert.match(agentModeContext("chat", "en"), /general assistance/);
});
test("Coder workflow distinguishes sandbox evidence, remote writes and interrupted work", () => {
  const coder = agentModeContext("coder", "en");
  assert.match(coder, /not automatically mounted/);
  assert.match(coder, /tested files and revision are shown to match/);
  assert.match(coder, /do not overwrite a newer remote revision/);
  assert.match(coder, /Re-read and reconcile conflicts/);
  assert.match(coder, /regression tests/);
  assert.match(coder, /never blindly repeat an uncertain external write/);
  assert.match(coder, /report skipped or unavailable checks/);
  assert.match(coder, /do not promise unlimited or background execution/);
});
