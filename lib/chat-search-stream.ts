import { waitWithAbort } from "@/lib/abortable";
import type { ChatSearchResult, SearchSnippet } from "./chat-search";

// A single line can contain tool output or attachments, so bound both the
// whole stream and a line before parsing. Limits result in "unavailable",
// never a false definitive no-match.
export const MAX_SEARCH_STREAM_BYTES = 4_000_000;
export const MAX_SEARCH_LINE_CHARS = 1_000_000;
export const MAX_SEARCH_EVENTS = 40_000;
const MAX_PENDING_PARTS = 500;
const CONTEXT_BEFORE = 24;
const CONTEXT_AFTER = 60;
const SUPPORTED_STREAM_VERSION = "27";

type PendingPart = {
  turnId?: string;
  runId?: string;
  kind?: string;
  tail: string;
  snippet?: SearchSnippet;
};

function snippetFor(text: string, matcher: RegExp): SearchSnippet | undefined {
  // NFC lets a composed query match the same displayed decomposed text.
  const normalized = text.normalize("NFC");
  const found = matcher.exec(normalized);
  if (!found) return;
  let start = Math.max(0, found.index - CONTEXT_BEFORE);
  let end = Math.min(normalized.length, found.index + found[0].length + CONTEXT_AFTER);
  // Do not split surrogate pairs at the edges of an excerpt.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(normalized[start])) start--;
  if (end < normalized.length && /[\uDC00-\uDFFF]/.test(normalized[end])) end++;
  return {
    before: (start ? "…" : "") + normalized.slice(start, found.index),
    match: found[0],
    after: normalized.slice(found.index + found[0].length, end) + (end < normalized.length ? "…" : ""),
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Project exactly the text parts the v1 chat UI renders: the text a person
 * sent, imported history, and completed assistant text. Reasoning, tool
 * output, results and file metadata are not conversation text.
 *
 * A streaming text run is tentative until its content.completed replaces it,
 * its model settles, or the bounded tail is reached. */
class TextSearch {
  private readonly matcher: RegExp;
  private readonly pending = new Map<string, PendingPart>();
  private readonly runTurns = new Map<string, string>();
  incomplete = false;

  constructor(query: string) {
    this.matcher = new RegExp(query.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  }

  private match(text: string) { return snippetFor(text, this.matcher); }

  private scope(event: Record<string, unknown>) {
    const scope = object(event.scope);
    return {
      runId: stringField(scope?.runId),
      turnId: stringField(scope?.turnId),
    };
  }

  private delivery(data: Record<string, unknown>): SearchSnippet | undefined {
    if (typeof data.turnId !== "string" || data.turnId.length > 512) throw new Error("Invalid delivery");
    const history = data.history;
    if (history !== undefined) {
      if (!Array.isArray(history)) throw new Error("Invalid history");
      for (const item of history) {
        const message = object(item);
        if (!message || !["user", "assistant"].includes(String(message.role)) ||
            typeof message.text !== "string") throw new Error("Invalid history message");
        const result = this.match(message.text);
        if (result) return result;
      }
    }
    const parts = data.parts;
    if (!Array.isArray(parts)) throw new Error("Invalid delivery parts");
    const texts: string[] = [];
    for (const item of parts) {
      const part = object(item);
      if (!part || typeof part.kind !== "string") throw new Error("Invalid delivery part");
      if (part.kind !== "text") continue;
      if (typeof part.text !== "string") throw new Error("Invalid text part");
      texts.push(part.text);
    }
    return this.match(texts.join("\n"));
  }

  private contentCompleted(data: Record<string, unknown>) {
    const partId = stringField(data.partId);
    const runId = stringField(data.runId);
    const kind = stringField(data.kind);
    if (!partId || !runId || !kind) throw new Error("Invalid content completion");
    this.pending.delete(partId);
    // Only assistant text is conversation text; reasoning and results are not.
    if (kind !== "text") return;
    if (typeof data.value === "string") return this.match(data.value);
    // A large or withheld value cannot be searched, so a negative result is
    // never definitive.
    this.incomplete = true;
  }

  private contentDelta(event: Record<string, unknown>, data: Record<string, unknown>) {
    const partId = stringField(data.partId);
    const delta = stringField(data.delta);
    if (!partId || delta === undefined) throw new Error("Invalid content delta");
    const scope = this.scope(event);
    const previous = this.pending.get(partId);
    const kind = stringField(data.kind) ?? previous?.kind;
    if (!previous && this.pending.size >= MAX_PENDING_PARTS) throw new Error("Too many pending parts");
    const text = (previous?.tail ?? "") + delta;
    this.pending.set(partId, {
      turnId: scope.turnId ?? previous?.turnId,
      runId: scope.runId ?? previous?.runId,
      kind,
      tail: text.slice(-(this.matcher.source.length + CONTEXT_BEFORE + 4)),
      snippet: previous?.snippet ?? this.match(text),
    });
  }

  private modelSettled(data: Record<string, unknown>) {
    const runId = stringField(data.runId);
    if (!runId) throw new Error("Invalid model settlement");
    // The UI drops the run's unfinished previews when the model settles, so a
    // tentative match from this run is no longer visible.
    for (const [partId, part] of this.pending) if (part.runId === runId) this.pending.delete(partId);
    this.runTurns.delete(runId);
  }

  private turnSettled(data: Record<string, unknown>): SearchSnippet | undefined {
    const turnId = stringField(data.turnId);
    if (!turnId) throw new Error("Invalid turn settlement");
    let result: SearchSnippet | undefined;
    for (const [partId, part] of this.pending) {
      const owner = part.turnId ?? (part.runId ? this.runTurns.get(part.runId) : undefined);
      if (owner !== turnId) continue;
      if (part.kind === undefined || part.kind === "text") result ??= part.snippet;
      this.pending.delete(partId);
    }
    return result;
  }

  private modelRequested(data: Record<string, unknown>) {
    const runId = stringField(data.runId);
    const owner = object(data.owner);
    if (!runId || !owner) throw new Error("Invalid model request");
    const turnId = stringField(owner.turnId);
    if (!turnId) return; // A context summary is not part of a turn's conversation.
    if (this.runTurns.size >= MAX_PENDING_PARTS) this.runTurns.clear();
    this.runTurns.set(runId, turnId);
  }

  /** One stored fact or progress record. */
  event(input: unknown): SearchSnippet | undefined {
    const event = object(input);
    if (!event || typeof event.type !== "string") throw new Error("Invalid event");
    const data = object(event.data);
    if (!data) throw new Error("Invalid event data");
    switch (event.type) {
      case "delivery.consumed":
        return this.delivery(data);
      case "content.delta":
        this.contentDelta(event, data);
        return;
      case "content.completed":
        return this.contentCompleted(data);
      case "model.requested":
        this.modelRequested(data);
        return;
      case "model.settled":
        this.modelSettled(data);
        return;
      case "turn.settled":
        return this.turnSettled(data);
      default:
        // Includes turns, calls, interactions, usage, context changes and
        // session lifecycle. The chat UI retains earlier messages across a
        // context change.
        return;
    }
  }

  finish(): SearchSnippet | undefined {
    for (const run of this.pending.values()) {
      if ((run.kind === undefined || run.kind === "text") && run.snippet) return run.snippet;
    }
    return;
  }
}

/** Read exactly the pinned durable tail, counting stored NDJSON lines just like
 * Eve's client: transport records are not stored and do not advance the
 * position. A disconnect, malformed line, unsupported version, timeout or
 * limit before that tail means the search is incomplete. */
export async function searchEveStream(response: Response, query: string, signal: AbortSignal): Promise<ChatSearchResult> {
  const unavailable: ChatSearchResult = { status: "unavailable" };
  // Keep this allowlist aligned with the installed Eve client's supported
  // stream version when upgrading the dependency.
  const version = response.headers.get("x-eve-stream-version");
  const rawTail = response.headers.get("x-eve-stream-tail-index");
  if (!response.ok || !response.body || version !== SUPPORTED_STREAM_VERSION ||
      !rawTail || !/^-?\d+$/.test(rawTail)) return unavailable;
  const tail = Number(rawTail);
  if (!Number.isSafeInteger(tail) || tail < -1 || signal.aborted) return unavailable;
  if (tail === -1) {
    void response.body.cancel().catch(() => {});
    return { status: "no-match" };
  }

  const search = new TextSearch(query);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let events = 0;
  let lineIndex = 0;
  let sawStoredLine = false;
  let done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });

  const consumeStoredLine = (value: Record<string, unknown>): SearchSnippet | undefined => {
    const facts = value.facts;
    const progress = "progress" in value;
    if (facts === undefined && !progress) throw new Error("Invalid stored line");
    sawStoredLine = true;
    const records = progress ? [value.progress] : facts;
    if (!Array.isArray(records) || records.length === 0) throw new Error("Invalid stored line");
    for (const item of records) {
      events++;
      const result = search.event(item);
      if (result) return result;
      if (events >= MAX_SEARCH_EVENTS) throw new Error("Too many events");
    }
    return;
  };

  const consumeLine = (line: string): ChatSearchResult | undefined => {
    if (!line.trim()) return;
    if (line.length > MAX_SEARCH_LINE_CHARS) throw new Error("Line too large");
    const value = object(JSON.parse(line));
    if (!value) throw new Error("Invalid record");
    // Transport records are never stored and never counted.
    if ("$eve" in value) {
      if (value.$eve === "position" && !sawStoredLine &&
          Number.isSafeInteger(value.next) && (value.next as number) >= 0) {
        lineIndex = value.next as number;
      }
      return;
    }
    const snippet = consumeStoredLine(value);
    if (snippet) return { status: "matched", snippet };
    if (lineIndex === tail) {
      const partial = search.finish();
      return partial ? { status: "matched", snippet: partial } : search.incomplete ? unavailable : { status: "no-match" };
    }
    lineIndex++;
    return;
  };

  try {
    while (!signal.aborted) {
      const part = await waitWithAbort(reader.read(), signal);
      if (signal.aborted) return unavailable;
      if (part.done) {
        done = true;
        buffer += decoder.decode();
        return consumeLine(buffer) ?? unavailable;
      }
      bytes += part.value.byteLength;
      if (bytes > MAX_SEARCH_STREAM_BYTES) return unavailable;
      buffer += decoder.decode(part.value, { stream: true });
      let newline: number;
      let offset = 0;
      while ((newline = buffer.indexOf("\n", offset)) !== -1) {
        const result = consumeLine(buffer.slice(offset, newline));
        if (result) return result;
        offset = newline + 1;
      }
      buffer = buffer.slice(offset);
      if (buffer.length > MAX_SEARCH_LINE_CHARS) return unavailable;
    }
  } catch {
    return unavailable;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!done) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* An uncooperative read can still own the lock. */ }
  }
  return unavailable;
}
