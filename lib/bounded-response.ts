import { waitWithAbort } from "./abortable";

/** Consume a bounded UTF-8 body, including while an upstream ignores abort.
 * Cancellation is best effort and does not undo an upstream request. */
export async function readBoundedResponseText(response: Response, signal: AbortSignal, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error("Response too large.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "", size = 0, count = 0, complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await waitWithAbort(reader.read(), signal);
      if (chunk.done) { complete = true; break; }
      if (++count > 65_536) throw new Error("Too many response chunks.");
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error("Response too large.");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A pending read may still own the lock. */ }
  }
}
