import { removeVercelHistory, updateVercelHistory, vercelHistoryEnabled } from "@/lib/vercel-history-store";
import { OWNER_PROOF_HEADER } from "@/lib/security/chat-ownership";
import { ownedChat } from "@/lib/security/owned-chat";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";
import { readBoundedJson } from "@/lib/bounded-json";
import { waitWithAbort } from "@/lib/abortable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ sessionId: string }> };

// Keep legacy clients working, while newer clients bind actions to the account
// that initiated them. Ownership is still verified independently.
function mismatchedAccount(request: Request, owned: { userId: string; kind: string }) {
  const id = request.headers.get("x-tflash-expected-user-id");
  const kind = request.headers.get("x-tflash-expected-account-kind");
  return (id !== null && id !== owned.userId) || (kind !== null && kind !== owned.kind);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const { sessionId } = await context.params;
  const owned = await ownedChat(request, sessionId, false);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });
  if (mismatchedAccount(request, owned)) return Response.json({ error: "Account changed. Reload to continue." }, { status: 409 });
  const input = await readBoundedJson(request, 4096);
  if (!input.ok) return Response.json({ error: input.error }, { status: input.status });
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) return Response.json({ error: "Invalid request." }, { status: 400 });
  const body = input.value as { title?: unknown; activity?: unknown };
  if (body.activity !== undefined && typeof body.activity !== "boolean") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
  if (owned.kind === "vercel") {
    if (!vercelHistoryEnabled()) return Response.json({ ok: true });
    try {
      const savedTitle = await updateVercelHistory(owned.userId, sessionId, title, body.activity === true);
      return savedTitle === null ? Response.json({ error: "Conversation not available." }, { status: 404 }) : Response.json({ ok: true, title: savedTitle });
    } catch { return Response.json({ error: "Could not update conversation." }, { status: 503 }); }
  }

  // Sending a message may supply an initial title, but must never overwrite a
  // name changed on this or another device. The null check is atomic in SQL.
  if (body.activity === true) {
    const { error } = await owned.supabase.from("tflash_chats")
      .update({ title }).eq("session_id", sessionId).eq("user_id", owned.userId).is("title", null);
    if (error) return Response.json({ error: "Could not update conversation." }, { status: 503 });
  }
  const { data, error } = await owned.supabase.from("tflash_chats")
    .update(body.activity === true ? { updated_at: new Date().toISOString() } : { title, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId).eq("user_id", owned.userId).select("title").maybeSingle();
  if (error) return Response.json({ error: "Could not update conversation." }, { status: 503 });
  if (!data) return Response.json({ error: "Conversation not available." }, { status: 404 });
  return Response.json({ ok: true, title: data.title });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const { sessionId } = await context.params;
  const owned = await ownedChat(request, sessionId, false);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });
  if (mismatchedAccount(request, owned)) return Response.json({ error: "Account changed. Reload to continue." }, { status: 409 });

  // Persist a non-revivable index tombstone before attempting Eve reset.
  if (owned.kind === "vercel" && vercelHistoryEnabled()) {
    try { if (!await removeVercelHistory(owned.userId, sessionId)) return Response.json({ error: "Conversation not available." }, { status: 404 }); }
    catch { return Response.json({ error: "Could not remove conversation." }, { status: 503 }); }
  }
  // Best effort: Eve retains workflow events according to its own retention policy.
  try {
    const headers = internalEveHeaders({ cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" });
    if (owned.kind === "vercel") headers.set(OWNER_PROOF_HEADER, owned.proof);
    const signal = AbortSignal.timeout(5000);
    const pending = fetch(`${internalOrigin()}/eve/v1/session/${encodeURIComponent(sessionId)}/reset`, {
      method: "POST", headers, body: "{}", cache: "no-store", redirect: "error", signal,
    });
    void pending.then((response) => {
      if (signal.aborted && response.body) void response.body.cancel().catch(() => {});
    }, () => {});
    await waitWithAbort(pending, signal);
  } catch {
    // Removing a browser copy or Supabase row is not irreversible erasure.
  }
  if (owned.kind === "vercel") return Response.json({ ok: true });
  const { error } = await owned.supabase.from("tflash_chats").delete()
    .eq("session_id", sessionId).eq("user_id", owned.userId);
  return error
    ? Response.json({ error: "Could not remove conversation." }, { status: 503 })
    : Response.json({ ok: true });
}
