import { beginSyncUncertainty, clearSyncUncertainty, syncUncertaintyMarkers } from "@/lib/sync-uncertainty";

export type ChatActionWarning = { readonly key: string; readonly chatId?: string; readonly action?: "activity" | "rename" | "remove" };
export class ChatActionUncertainError extends Error {
  constructor() { super("The previous chat action has an unknown outcome."); this.name = "ChatActionUncertainError"; }
}

/** Values contain an identifier and action only, never titles, proofs or text. */
export function chatActionWarnings(kind: string, userId: string): ChatActionWarning[] {
  return syncUncertaintyMarkers("chat-action", kind, userId).map((key) => {
    try {
      const data: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      if (data && typeof data === "object") {
        const value = data as Record<string, unknown>;
        if (typeof value.chatId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value.chatId) &&
            (value.action === "activity" || value.action === "rename" || value.action === "remove")) {
          return { key, chatId: value.chatId, action: value.action };
        }
      }
    } catch { /* Invalid markers remain a conservative, account-wide hold. */ }
    return { key };
  });
}

export function beginChatAction(kind: string, userId: string, chatId: string, action: "activity" | "rename" | "remove") {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(chatId)) throw new Error("Invalid conversation ID.");
  return beginSyncUncertainty("chat-action", kind, userId, JSON.stringify({ chatId, action }));
}
export function clearChatAction(key: string) { clearSyncUncertainty([key]); }
