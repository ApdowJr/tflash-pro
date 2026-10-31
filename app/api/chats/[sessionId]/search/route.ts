import { readBoundedJson } from "@/lib/bounded-json";
import { waitWithAbort } from "@/lib/abortable";
import { MAX_MESSAGE_QUERY_LENGTH, MIN_MESSAGE_QUERY_LENGTH } from "@/lib/chat-search";
import { searchEveStream } from "@/lib/chat-search-stream";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership";
import { ownedChat } from "@/lib/security/owned-chat";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const noStore = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 2_048;
const MAX_ACTIVE_SEARCHES = 8; // Per server instance, not a distributed rate limit.
let activeSearches = 0;

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

async function readQuery(request: Request): Promise<string | undefined> {
  const body = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) return;
  const query = (body.value as { query?: unknown }).query;
  if (typeof query !== "string") return;
  const trimmed = query.trim();
  return trimmed.length >= MIN_MESSAGE_QUERY_LENGTH && trimmed.length <= MAX_MESSAGE_QUERY_LENGTH ? trimmed : undefined;
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ error: "Invalid origin." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return reply({ error: "Expected JSON." }, 415);
  const { sessionId } = await context.params;
  let owned;
  try { owned = await ownedChat(request, sessionId); }
  catch { return reply({ status: "unavailable" }, 503); }
  if (!owned) return reply({ error: "Conversation not available." }, 404);
  const query = await readQuery(request);
  if (!query) return reply({ error: "Invalid search." }, 400);
  if (activeSearches >= MAX_ACTIVE_SEARCHES) return reply({ status: "unavailable" }, 503);

  activeSearches++;
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(12_000)]);
  try {
    const headers = internalEveHeaders({
      cookie: request.headers.get("cookie") ?? "",
      accept: "application/x-ndjson",
    });
    if (owned.kind === "vercel") headers.set(OWNER_PROOF_HEADER, owned.proof);
    const pending = fetch(`${internalOrigin()}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?follow=false&includeTailIndex=1`, {
      method: "GET", headers, cache: "no-store", redirect: "error", signal,
    });
    // If a transport ignores abort and later returns, release its body without
    // waiting or interpreting a stale response.
    void pending.then((response) => { if (signal.aborted && response.body) void response.body.cancel().catch(() => {}); }, () => {});
    const response = await waitWithAbort(pending, signal);
    // Expired, forbidden, missing and temporarily unavailable transcripts all
    // remain partial results; never expose Eve's raw body or error details.
    const result = await searchEveStream(response, query, signal);
    if (!response.ok && response.body) void response.body.cancel().catch(() => {});
    return reply(result);
  } catch {
    return reply({ status: "unavailable" });
  } finally {
    controller.abort();
    activeSearches--;
  }
}
