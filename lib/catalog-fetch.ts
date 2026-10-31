import { waitWithAbort } from "./abortable";

/** Bounded JSON response reader; cancellation does not undo remote work. */
export async function readCatalogJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error("Response too large.");
  }
  if (!response.body) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "", bytes = 0, complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await waitWithAbort(reader.read(), signal);
      if (chunk.done) { complete = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("Response too large.");
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw) as unknown;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read may still own the lock. */ }
  }
}

export async function fetchCatalogResponse(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; signal: AbortSignal }> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  signal.throwIfAborted();
  const pending = fetch(url, { ...init, signal });
  void pending.then((response) => {
    if (signal.aborted && response.body) void response.body.cancel().catch(() => {});
  }, () => {});
  return { response: await waitWithAbort(pending, signal), signal };
}

export async function fetchCatalogJson(url: string, init: RequestInit = {}, timeoutMs = 12_000, maxBytes = 1_048_576) {
  const { response, signal } = await fetchCatalogResponse(url, init, timeoutMs);
  if (!response.ok) {
    if (response.body) void response.body.cancel().catch(() => {});
    return { response, data: undefined };
  }
  const data = await readCatalogJson(response, signal, maxBytes);
  return { response, data };
}
