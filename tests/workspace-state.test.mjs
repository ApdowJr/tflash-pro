import test from "node:test";
import assert from "node:assert/strict";
import { groupChats, searchChats, sessionTitle } from "../lib/chat-history.ts";
import { providerConnectionExpired } from "../lib/providers/connection-state.ts";

const chat = (id, title, updatedAt) => ({ id, title, updatedAt });

test("history uses local calendar days and sorts newest first", () => {
  // Yesterday was only 31 minutes ago, but is not today.
  const now = new Date(2026, 9, 28, 0, 30).getTime();
  const yesterday = new Date(2026, 9, 27, 23, 59).getTime();
  const midnight = new Date(2026, 9, 28, 0, 0).getTime();
  const groups = groupChats([
    chat("yesterday", "Yesterday", yesterday),
    chat("midnight", "At midnight", midnight),
    chat("now", "Now", now),
  ], now);
  assert.deepEqual(groups.map((group) => [group.key, group.chats.map((item) => item.id)]), [
    ["today", ["now", "midnight"]],
    ["earlier", ["yesterday"]],
  ]);
});

test("chat search is case-insensitive and titles are readable", () => {
  const chats = [chat("1", "Somali plan", 1), chat("2", "API notes", 2)];
  assert.deepEqual(searchChats(chats, "  SOMALI ").map((item) => item.id), ["1"]);
  assert.equal(searchChats(chats, "missing").length, 0);
  assert.equal(searchChats(chats, " "), chats);
  assert.equal(sessionTitle([{ role: "user", parts: [{ type: "text", text: "  A useful question  " }] }], "New chat"), "A useful question");
});

test("saved provider credentials report expiry without affecting keyless connections", () => {
  const connectedAt = 1_000;
  const week = 7 * 24 * 60 * 60 * 1_000;
  assert.equal(providerConnectionExpired(undefined, connectedAt + week), false);
  assert.equal(providerConnectionExpired({ connectedAt }, connectedAt + week), false);
  assert.equal(providerConnectionExpired({ token: "sealed", connectedAt }, connectedAt + week - 1), false);
  assert.equal(providerConnectionExpired({ token: "sealed", connectedAt }, connectedAt + week), true);
  assert.equal(providerConnectionExpired({ token: "sealed", connectedAt, expiresAt: 5_000 }, 5_000), true);
  assert.equal(providerConnectionExpired({ token: "sealed", connectedAt, expiresAt: 5_000 }, 4_999), false);
});
