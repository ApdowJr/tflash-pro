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
  assert.match(research, /successfully fetched sources/);
  assert.match(research, /never invent a source/);
  assert.match(research, /Somali/);
  assert.match(agentModeContext("chat", "en"), /general assistance/);
});