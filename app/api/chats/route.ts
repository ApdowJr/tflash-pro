import { serverSupabase } from "@/lib/supabase/server";
import { CREATE_PROOF_HEADER, signChatCreation, signChatOwnership, verifyChatOwnership } from "@/lib/security/chat-ownership";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  const supabase = await serverSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { data, error } = await supabase
    .from("tflash_chats")
    .select("session_id,title,updated_at,owner_proof")
    .eq("user_id", auth.user.id)
    .not("title", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: "Could not load conversations." }, { status: 503, headers: noStore });
  const chats = (data ?? [])
    .filter((chat) => verifyChatOwnership(auth.user.id, chat.session_id, chat.owner_proof))
    .map((chat) => ({ id: chat.session_id, title: chat.title, updatedAt: Date.parse(chat.updated_at) }));
  return Response.json({ chats }, { headers: noStore });
}

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  const supabase = await serverSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  try {
    const headers = internalEveHeaders({
      cookie: request.headers.get("cookie") ?? "",
      [CREATE_PROOF_HEADER]: signChatCreation(auth.user.id),
    });
    for (const name of ["x-ururka-provider", "x-ururka-model", "x-ururka-context", "x-ururka-token"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // This URL is selected from server configuration, not the incoming Host header.
    const response = await fetch(`${internalOrigin()}/eve/v1/session`, {
      method: "POST", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      console.error("[tflash] eve session creation failed", response.status);
      return Response.json({ error: "Could not start a conversation. Please try again." }, { status: 503 });
    }
    const body = (await response.json()) as { sessionId?: unknown };
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) {
      return Response.json({ error: "The conversation service returned an invalid response." }, { status: 502 });
    }
    const { error } = await supabase.from("tflash_chats").insert({
      session_id: sessionId,
      user_id: auth.user.id,
      owner_proof: signChatOwnership(auth.user.id, sessionId),
      title: null,
    });
    if (error) {
      console.error("[tflash] could not register session", error.message);
      return Response.json({ error: "Could not save the conversation. Please try again." }, { status: 503 });
    }
    return Response.json({ sessionId }, { status: 201, headers: noStore });
  } catch (error) {
    console.error("[tflash] session creation unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Conversation service is unavailable. Please try again." }, { status: 503 });
  }
}
