import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { OWNER_PROOF_HEADER, verifyChatOwnership } from "@/lib/security/chat-ownership";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ sessionId: string }> };

async function ownedChat(request: Request, sessionId: string) {
  const principal = await currentPrincipal();
  if (!principal) return null;
  if (principal.kind === "vercel") {
    const proof = request.headers.get(OWNER_PROOF_HEADER);
    return verifyChatOwnership(principal.id, sessionId, proof)
      ? { kind: "vercel" as const, userId: principal.id, proof: proof! }
      : null;
  }
  const supabase = await serverSupabase();
  const { data: chat } = await supabase.from("tflash_chats")
    .select("owner_proof")
    .eq("session_id", sessionId)
    .eq("user_id", principal.id)
    .maybeSingle();
  if (!chat || !verifyChatOwnership(principal.id, sessionId, chat.owner_proof)) return null;
  return { kind: "supabase" as const, supabase, userId: principal.id };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const { sessionId } = await context.params;
  const owned = await ownedChat(request, sessionId);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });
  let body: { title?: unknown; activity?: unknown };
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid request");
    body = input as { title?: unknown; activity?: unknown };
  } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (body.activity !== undefined && typeof body.activity !== "boolean") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
  // Vercel-account titles are saved in the account-scoped browser index.
  if (owned.kind === "vercel") return Response.json({ ok: true });

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
  const owned = await ownedChat(request, sessionId);
  if (!owned) return Response.json({ error: "Conversation not available." }, { status: 404 });

  // Best effort: Eve retains workflow events according to its own retention policy.
  try {
    const headers = internalEveHeaders({ cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" });
    if (owned.kind === "vercel") headers.set(OWNER_PROOF_HEADER, owned.proof);
    await fetch(`${internalOrigin()}/eve/v1/session/${encodeURIComponent(sessionId)}/reset`, {
      method: "POST", headers, body: "{}", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
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
