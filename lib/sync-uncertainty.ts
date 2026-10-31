/**
 * Durable per-operation breadcrumbs, not a lock. Keys contain account IDs. Storage failures
 * throw so callers can avoid dispatching without a recoverable warning.
 */
function prefix(scope: "workspace" | "history" | "chat-action" | "chat-create" | "oauth-refresh" | "oauth-handoff" | "control-permission" | "control-task" | "control-continuation" | "input-response" | "stop-request" | "turn-dispatch", kind: string, userId: string) {
  return `tflash:sync-uncertain:${scope}:${encodeURIComponent(kind)}:${encodeURIComponent(userId)}:`;
}

export function syncUncertaintyMarkers(scope: "workspace" | "history" | "chat-action" | "chat-create" | "oauth-refresh" | "oauth-handoff" | "control-permission" | "control-task" | "control-continuation" | "input-response" | "stop-request" | "turn-dispatch", kind: string, userId: string): string[] {
  const storage = window.localStorage;
  const start = prefix(scope, kind, userId);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(start)) keys.push(key);
  }
  return keys;
}

export function beginSyncUncertainty(scope: "workspace" | "history" | "chat-action" | "chat-create" | "oauth-refresh" | "oauth-handoff" | "control-permission" | "control-task" | "control-continuation" | "input-response" | "stop-request" | "turn-dispatch", kind: string, userId: string, value = "1"): string {
  const key = `${prefix(scope, kind, userId)}${crypto.randomUUID()}`;
  window.localStorage.setItem(key, value);
  return key;
}

export function clearSyncUncertainty(keys: readonly string[]): void {
  for (const key of keys) window.localStorage.removeItem(key);
}
