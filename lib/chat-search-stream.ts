import type { ChatSearchResult, SearchSnippet } from "./chat-search";

// A single event can contain tool output or attachments, so bound both the
// whole stream and a line before parsing. Limits result in "unavailable",
// never a false definitive no-match.
export const MAX_SEARCH_STREAM_BYTES = 4_000_000;
export const MAX_SEARCH_LINE_CHARS = 1_000_000;
export const MAX_SEARCH_EVENTS = 40_000;
const MAX_PENDING_RUNS = 500;
const CONTEXT_BEFORE = 24;
const CONTEXT_AFTER = 60;

type PendingRun = { turnId: string; stepIndex: number; tail: string; snippet?: SearchSnippet };

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

/** Project the text parts that Eve's default message reducer shows. A streaming
 * text run is tentative until it closes or the bounded tail is reached: a
 * later message.completed replaces its deltas, rather than appending to them. */
class TextSearch {
  private readonly matcher: RegExp;
  private readonly version: number;
  private readonly pending = new Map<string, PendingRun>();
  incomplete = false;

  constructor(query: string, version: number) {
    this.version = version;
    this.matcher = new RegExp(query.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  }

  private match(text: string) { return snippetFor(text, this.matcher); }
  private validateAppend(data: Record<string, unknown>, deltaName: string, snapshotName: string, offsetName: string) {
    const delta = data[deltaName];
    if (typeof delta !== "string") throw new Error("Invalid append delta");
    if (this.version <= 24) {
      const snapshot = data[snapshotName];
      if (typeof snapshot !== "string" || !snapshot.endsWith(delta)) throw new Error("Invalid legacy snapshot");
    } else if (snapshotName in data || offsetName in data) {
      throw new Error("Invalid current append shape");
    }
  }
  private key(data: Record<string, unknown>): string {
    if (typeof data.turnId !== "string" || data.turnId.length > 512 ||
        !Number.isSafeInteger(data.stepIndex) || (data.stepIndex as number) < 0) throw new Error("Invalid text event");
    return JSON.stringify([data.turnId, data.stepIndex]);
  }

  event(input: unknown): SearchSnippet | undefined {
    const event = object(input);
    if (!event || typeof event.type !== "string" || !object(event.data)) throw new Error("Invalid event");
    const data = object(event.data)!;
    switch (event.type) {
      case "message.received": {
        if (data.parts !== undefined) {
          if (!Array.isArray(data.parts)) throw new Error("Invalid message parts");
          const texts: string[] = [];
          for (const item of data.parts) {
            const part = object(item);
            if (!part || typeof part.type !== "string") throw new Error("Invalid message part");
            if (part.type === "text") {
              if (typeof part.text !== "string") throw new Error("Invalid text part");
              texts.push(part.text);
            }
          }
          return this.match(texts.join("\n"));
        }
        if (typeof data.message !== "string") throw new Error("Invalid message");
        // Older streams can contain only Eve's flattened attachment summary.
        // Filenames can contain brackets/newlines, so they cannot safely be
        // separated from text. Skip that message and mark a negative partial.
        if (data.message.includes("[file: ") || data.message.includes("[image: ")) {
          this.incomplete = true;
          return;
        }
        return this.match(data.message);
      }
      case "history.imported": {
        if (!Array.isArray(data.messages)) throw new Error("Invalid history");
        for (const item of data.messages) {
          const message = object(item);
          if (!message || !["user", "assistant"].includes(String(message.role)) || typeof message.text !== "string") throw new Error("Invalid history message");
          const result = this.match(message.text);
          if (result) return result;
        }
        return;
      }
      case "message.appended": {
        const key = this.key(data);
        this.validateAppend(data, "messageDelta", "messageSoFar", "messageOffset");
        if (typeof data.messageDelta !== "string" || !data.messageDelta) return;
        if (!this.pending.has(key) && this.pending.size >= MAX_PENDING_RUNS) throw new Error("Too many pending runs");
        const previous = this.pending.get(key);
        const text = (previous?.tail ?? "") + data.messageDelta;
        this.pending.set(key, {
          turnId: data.turnId as string,
          stepIndex: data.stepIndex as number,
          tail: text.slice(-(this.matcher.source.length + CONTEXT_BEFORE + 4)),
          snippet: previous?.snippet ?? this.match(text),
        });
        return;
      }
      case "reasoning.appended":
        this.validateAppend(data, "reasoningDelta", "reasoningSoFar", "reasoningOffset");
        return;
      case "action.input.appended":
        if (typeof data.inputTextDelta !== "string" ||
            (this.version < 24) ||
            (this.version === 24 && (!Number.isSafeInteger(data.inputTextOffset) || (data.inputTextOffset as number) < 0)) ||
            (this.version > 24 && "inputTextOffset" in data)) throw new Error("Invalid action input");
        return;
      case "message.completed": {
        const key = this.key(data);
        if (typeof data.message !== "string") throw new Error("Invalid completed message");
        this.pending.delete(key); // completion replaces the streaming run
        return this.match(data.message);
      }
      case "step.completed": {
        const key = this.key(data);
        const run = this.pending.get(key);
        this.pending.delete(key);
        return run?.snippet;
      }
      case "turn.completed":
      case "turn.cancelled":
      case "turn.failed": {
        if (typeof data.turnId !== "string") throw new Error("Invalid turn");
        let result: SearchSnippet | undefined;
        for (const [key, run] of this.pending) {
          if (run.turnId === data.turnId) {
            result ??= run.snippet;
            this.pending.delete(key);
          }
        }
        return result;
      }
      default:
        // Includes context.cleared, reasoning, tools, results and attachments.
        // The chat UI retains earlier messages across context.cleared.
        return;
    }
  }

  finish(): SearchSnippet | undefined {
    for (const run of this.pending.values()) if (run.snippet) return run.snippet;
    return;
  }
}

/** Read exactly the pinned durable tail, counting NDJSON events just like Eve's
 * client. A disconnect, malformed event, unsupported version, timeout or
 * limit before that tail means the search is incomplete. */
export async function searchEveStream(response: Response, query: string, signal: AbortSignal): Promise<ChatSearchResult> {
  const unavailable: ChatSearchResult = { status: "unavailable" };
  // Keep this allowlist/append validation aligned with the installed Eve
  // client's supported stream versions when upgrading the dependency.
  const version = response.headers.get("x-eve-stream-version");
  const rawTail = response.headers.get("x-eve-stream-tail-index");
  if (!response.ok || !response.body || !version || !["21", "22", "23", "24", "25", "26"].includes(version) ||
      !rawTail || !/^-?\d+$/.test(rawTail)) return unavailable;
  const tail = Number(rawTail);
  if (!Number.isSafeInteger(tail) || tail < -1 || signal.aborted) return unavailable;
  if (tail === -1) {
    void response.body.cancel().catch(() => {});
    return { status: "no-match" };
  }

  const search = new TextSearch(query, Number(version));
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let events = 0;
  let done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const consume = (line: string): ChatSearchResult | undefined => {
    if (!line.trim()) return;
    if (line.length > MAX_SEARCH_LINE_CHARS) throw new Error("Event too large");
    const event: unknown = JSON.parse(line);
    events++;
    const snippet = search.event(event);
    if (snippet) return { status: "matched", snippet };
    if (events === tail + 1) {
      const partial = search.finish();
      return partial ? { status: "matched", snippet: partial } : search.incomplete ? unavailable : { status: "no-match" };
    }
    if (events >= MAX_SEARCH_EVENTS) throw new Error("Too many events");
    return;
  };
  try {
    while (!signal.aborted) {
      const part = await reader.read();
      if (signal.aborted) return unavailable;
      if (part.done) {
        done = true;
        buffer += decoder.decode();
        return consume(buffer) ?? unavailable;
      }
      bytes += part.value.byteLength;
      if (bytes > MAX_SEARCH_STREAM_BYTES) return unavailable;
      buffer += decoder.decode(part.value, { stream: true });
      let newline: number;
      let offset = 0;
      while ((newline = buffer.indexOf("\n", offset)) !== -1) {
        const result = consume(buffer.slice(offset, newline));
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
    reader.releaseLock();
  }
  return unavailable;
}
