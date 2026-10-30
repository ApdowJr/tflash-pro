import { waitWithAbort } from "@/lib/abortable";

/** Read at most maxBytes without buffering an unbounded request. A timed-out
 * or interrupted read must not block a route even if the body ignores abort. */
export async function readBoundedJson(request: Request, maxBytes = 4096): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }
> {
  const invalid = { ok: false as const, status: 400 as const, error: "Invalid request." };
  const tooLarge = { ok: false as const, status: 413 as const, error: "Request too large." };
  if (!request.body) return invalid;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge;
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "", bytes = 0, complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await waitWithAbort(reader.read(), signal);
      if (chunk.done) { complete = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) return tooLarge;
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch { return invalid; }
  finally {
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* An uncooperative pending read may still own the lock. */ }
  }
}
