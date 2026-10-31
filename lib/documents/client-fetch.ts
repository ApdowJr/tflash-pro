import { fetchCatalogResponse, readCatalogJson } from "../catalog-fetch";
import { waitWithAbort } from "../abortable";

// The server gives document parsing a 12s worker budget; allow time for upload
// and response without waiting forever on a transport that ignores abort.
const DOCUMENT_TIMEOUT_MS = 25_000;
const MAX_EXTRACTION_RESPONSE = 1024 * 1024;
const MAX_EXPORT_RESPONSE = 16 * 1024 * 1024;

export async function fetchDocumentResponse(url: string, init: RequestInit) {
  const result = await fetchCatalogResponse(url, init, DOCUMENT_TIMEOUT_MS);
  if (!result.response.ok) {
    if (result.response.body) void result.response.body.cancel().catch(() => {});
    throw new Error("Document request failed.");
  }
  return result;
}

export async function readDocumentResult(response: Response, signal: AbortSignal) {
  return readCatalogJson(response, signal, MAX_EXTRACTION_RESPONSE);
}

export async function readDocumentBlob(response: Response, signal: AbortSignal, contentType: string): Promise<Blob> {
  if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== contentType) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error("Unexpected document type.");
  }
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_EXPORT_RESPONSE) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error("Document too large.");
  }
  if (!response.body) throw new Error("Missing document body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0, chunksRead = 0, complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await waitWithAbort(reader.read(), signal);
      if (chunk.done) { complete = true; break; }
      if (++chunksRead > 65_536) throw new Error("Too many response chunks.");
      bytes += chunk.value.byteLength;
      if (bytes > MAX_EXPORT_RESPONSE) throw new Error("Document too large.");
      chunks.push(new Uint8Array(chunk.value));
    }
    if (!bytes) throw new Error("Empty document.");
    return new Blob(chunks, { type: contentType });
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A pending read can outlive cancellation. */ }
  }
}
