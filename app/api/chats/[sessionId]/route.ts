import { serverSupabase } from "@/lib/supabase/server";
import { verifyChatOwnership } from "@/lib/security/chat-ownership";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ sessionId: string }> };

async function ownedChat(sessionId: string) {
  const supabase = await serverSupabase();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;
  const { data: chat } = await supabase.from("tflash_chats")
    .select("owner_proof")
    .eq("session_id", sessionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!chat || !verifyChatOwnership(auth.user.id, sessionId, chat.owner_proof)) return null;
  return { supabase, userId: auth.user.id };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const { sessionId } = await context.params;
  const owned = await ownedChat(sessionId);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });
  let body: { title?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
  const { error } = await owned.supabase.from("tflash_chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId).eq("user_id", owned.userId);
  return error
    ? Response.json({ error: "Could not update conversation." }, { status: 503 })
    : Response.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const { sessionId } = await context.params;
  const owned = await ownedChat(sessionId);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });

  // Best effort: stop any active workflow before revoking access. Eve retains
  // workflow events according to its own deployment retention policy.
  try {
    await fetch(`${internalOrigin()}/eve/v1/session/${encodeURIComponent(sessionId)}/reset`, {
      method: "POST",
      headers: internalEveHeaders({ cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" }),
      body: "{}",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Revocation below still prevents subsequent access to the session.
  }
  const { error } = await owned.supabase.from("tflash_chats").delete()
    .eq("session_id", sessionId).eq("user_id", owned.userId);
  return error
    ? Response.json({ error: "Could not remove conversation." }, { status: 503 })
    : Response.json({ ok: true });
}
