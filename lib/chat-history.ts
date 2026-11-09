import type { ChatRecord } from "@/components/settings/app-settings";

export type ChatGroupKey = "today" | "earlier";

export type ChatGroup = {
  readonly key: ChatGroupKey;
  readonly chats: readonly ChatRecord[];
};

/** Group by the user's calendar day rather than a rolling 24-hour window. */
export function groupChats(
  chats: readonly ChatRecord[],
  now: number = Date.now(),
): readonly ChatGroup[] {
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = sorted.filter((chat) => chat.updatedAt >= startOfToday.getTime());
  const earlier = sorted.filter((chat) => chat.updatedAt < startOfToday.getTime());
  return [
    ...(today.length > 0 ? [{ key: "today" as const, chats: today }] : []),
    ...(earlier.length > 0 ? [{ key: "earlier" as const, chats: earlier }] : []),
  ];
}

export function searchChats(
  chats: readonly ChatRecord[],
  query: string,
): readonly ChatRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return chats;
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle));
}

/** Clean up a raw prompt into a readable, word-boundary chat title. */
export function deriveChatTitle(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:#{1,6}|[-*>])\s+/, "")
    .trim();
  if (cleaned.length === 0) return fallback;
  const maxLength = 72;
  if (cleaned.length <= maxLength) return cleaned;
  const slice = cleaned.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const bounded = lastSpace >= Math.floor(maxLength * 0.55) ? slice.slice(0, lastSpace) : slice;
  return `${bounded.trimEnd()}…`;
}

/** Stable, human title for the current session. */
export function sessionTitle(
  messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[],
  fallback: string,
): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts.find((part) => part.type === "text" && part.text)?.text;
    if (text && text.trim().length > 0) return deriveChatTitle(text, fallback);
  }
  return fallback;
}
