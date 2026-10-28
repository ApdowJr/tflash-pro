import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { HEADER_INTEGRATION_TOKENS } from "@/lib/integrations/wire";
import { HEADER_PROVIDER, HEADER_MODEL, HEADER_CONTEXT, HEADER_TOKEN } from "@/lib/providers/selection";
import { CREATE_PROOF_HEADER, signChatCreation, signChatOwnership, verifyChatOwnership } from "@/lib/security/chat-ownership";
import { internalEveHeaders, internalOrigin } from "@/lib/security/internal-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  // Vercel users' signed index is account-scoped to their browser, not shared
  // through Supabase (their login is not a Supabase JWT).
  if (principal.kind === "vercel") return Response.json({ chats: [], storage: "browser" }, { headers: noStore });
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

  try {
    const headers = internalEveHeaders({
      cookie: request.headers.get("cookie") ?? "",
      [CREATE_PROOF_HEADER]: signChatCreation(principal.id),
    });
    for (const name of [HEADER_PROVIDER, HEADER_MODEL, HEADER_CONTEXT, HEADER_TOKEN, HEADER_INTEGRATION_TOKENS]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // The internal URL comes from server configuration, never an incoming Host.
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
    const ownerProof = signChatOwnership(principal.id, sessionId);
    if (principal.kind === "vercel") {
      return Response.json({ sessionId, ownerProof }, { status: 201, headers: noStore });
    }
    const supabase = await serverSupabase();
    const { error } = await supabase.from("tflash_chats").insert({
      session_id: sessionId, user_id: principal.id, owner_proof: ownerProof, title: null,
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
