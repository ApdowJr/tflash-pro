import { listVercelHistory, vercelHistoryEnabled } from "@/lib/vercel-history-store";
import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { HEADER_INTEGRATION_TOKENS } from "@/lib/integrations/wire";
import { HEADER_PROVIDER, HEADER_MODEL, HEADER_CONTEXT, HEADER_TOKEN } from "@/lib/providers/selection";
import { CREATE_PROOF_HEADER, signChatCreation, signChatOwnership, verifyChatOwnership } from "@/lib/security/chat-ownership";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";
import { guardRateLimit } from "@/lib/security/rate-limits";
import { waitWithAbort } from "@/lib/abortable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

/** Do not expose database details or silently fall back to another account. */
function chatStorageFailure(error: { code?: string; message?: string }, creationNotStarted = false): Response {
  const missingSchema = ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "");
  console.error("[tflash] chat storage unavailable", error.code ?? "unknown", error.message ?? "unknown");
  return Response.json({
    code: missingSchema ? "CHAT_STORAGE_SETUP_REQUIRED" : "CHAT_STORAGE_UNAVAILABLE",
    ...(creationNotStarted ? { creationNotStarted: true } : {}),
    error: missingSchema
      ? "Chat storage is not configured for this deployment."
      : "Could not save the conversation. Please try again.",
  }, { status: 503, headers: noStore });
}

export async function GET(request?: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  // New clients bind the response to the identity that initiated the request.
  // Older clients without these headers retain the previous read behavior.
  const expectedId = request?.headers.get("x-tflash-expected-user-id");
  const expectedKind = request?.headers.get("x-tflash-expected-account-kind");
  if ((expectedId !== null && expectedId !== undefined && expectedId !== principal.id) ||
      (expectedKind !== null && expectedKind !== undefined && expectedKind !== principal.kind)) {
    return Response.json({ error: "Account changed. Reload to continue." }, { status: 409, headers: noStore });
  }
  // Vercel principals cannot use Supabase RLS. The optional service-backed
  // index authenticates this principal and never exposes the service key.
  if (principal.kind === "vercel") {
    if (!vercelHistoryEnabled()) return Response.json({ chats: [], storage: "browser" }, { headers: noStore });
    try { return Response.json({ chats: await listVercelHistory(principal.id), storage: "account" }, { headers: noStore }); }
    catch { return Response.json({ error: "Could not load conversations." }, { status: 503, headers: noStore }); }
  }
  const supabase = await serverSupabase();
  const { data, error } = await supabase
    .from("tflash_chats")
    .select("session_id,title,updated_at,owner_proof")
    .eq("user_id", principal.id)
    .not("title", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: "Could not load conversations." }, { status: 503, headers: noStore });
  const chats = (data ?? [])
    .filter((chat) => verifyChatOwnership(principal.id, chat.session_id, chat.owner_proof))
    .map((chat) => ({ id: chat.session_id, title: chat.title, updatedAt: Date.parse(chat.updated_at) }));
  return Response.json({ chats, storage: "account" }, { headers: noStore });
}

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const expectedId = request.headers.get("x-tflash-expected-user-id");
  const expectedKind = request.headers.get("x-tflash-expected-account-kind");
  if ((expectedId !== null && expectedId !== principal.id) || (expectedKind !== null && expectedKind !== principal.kind)) {
    return Response.json({ error: "Account changed. Reload to continue." }, { status: 409, headers: noStore });
  }
  const limited = guardRateLimit("chatCreate", request, principal.id);
  if (limited) return limited;

  let creationStarted = false;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
    signal.throwIfAborted();
    // Do not create an unowned workflow when the authenticated user's chat
    // index is missing or unavailable. A zero-row SELECT verifies the schema
    // and permissions without returning chat data or weakening RLS. Use GET:
    // PostgREST's client can treat an empty-body HEAD 404 as a successful 204.
    const supabase = principal.kind === "supabase" ? await serverSupabase() : null;
    if (supabase) {
      const { error } = await waitWithAbort(supabase.from("tflash_chats")
        .select("session_id,user_id,owner_proof,title,updated_at").limit(0), signal);
      if (error) return chatStorageFailure(error, true);
    }
    const headers = internalEveHeaders({
      cookie: request.headers.get("cookie") ?? "",
      [CREATE_PROOF_HEADER]: signChatCreation(principal.id),
    });
    for (const name of [HEADER_PROVIDER, HEADER_MODEL, HEADER_CONTEXT, HEADER_TOKEN, HEADER_INTEGRATION_TOKENS]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // The internal URL comes from server configuration, never an incoming Host.
    signal.throwIfAborted();
    creationStarted = true;
    const pending = fetch(`${internalOrigin()}/eve/v1/session`, {
      method: "POST", headers, cache: "no-store", redirect: "error", signal,
    });
    void pending.then((response) => {
      if (signal.aborted && response.body) void response.body.cancel().catch(() => {});
    }, () => {});
    const response = await waitWithAbort(pending, signal);
    if (!response.ok) {
      console.error("[tflash] eve session creation failed", response.status);
      return Response.json({ error: "Could not start a conversation. Please try again." }, { status: 503 });
    }
    const body = (await waitWithAbort(response.json(), signal)) as { sessionId?: unknown };
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) {
      return Response.json({ error: "The conversation service returned an invalid response." }, { status: 502 });
    }
    const ownerProof = signChatOwnership(principal.id, sessionId);
    if (principal.kind === "vercel") {
      return Response.json({ sessionId, ownerProof }, { status: 201, headers: noStore });
    }
    if (!supabase) throw new Error("Missing authenticated chat storage client.");
    signal.throwIfAborted();
    const { error } = await waitWithAbort(supabase.from("tflash_chats").insert({
      session_id: sessionId, user_id: principal.id, owner_proof: ownerProof, title: null,
    }), signal);
    if (error) return chatStorageFailure(error);
    return Response.json({ sessionId }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("[tflash] session creation unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Conversation service is unavailable.", ...(!creationStarted ? { creationNotStarted: true } : {}) }, { status: 503, headers: noStore });
  }
}
