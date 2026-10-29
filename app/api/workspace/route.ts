import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { workspaceSchema } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
const MAX_BODY_CHARS = 200_000;

export async function GET(): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  // Vercel identities are not Supabase JWTs and must never be mapped to a Supabase row.
  if (principal.kind !== "supabase") return Response.json({ storage: "browser", workspace: null }, { headers: noStore });
  const supabase = await serverSupabase();
  const { data, error } = await supabase.from("tflash_workspaces")
    .select("workspace").eq("user_id", principal.id).maybeSingle();
  if (error) return Response.json({ error: "Workspace cloud sync is unavailable." }, { status: 503, headers: noStore });
  if (!data) return Response.json({ storage: "cloud", workspace: null }, { headers: noStore });
  const parsed = workspaceSchema.safeParse(data.workspace);
  if (!parsed.success) return Response.json({ error: "Saved workspace is invalid; local data was not overwritten." }, { status: 503, headers: noStore });
  return Response.json({ storage: "cloud", workspace: parsed.data }, { headers: noStore });
}

export async function PUT(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415, headers: noStore });
  }
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  if (principal.kind !== "supabase") return Response.json({ storage: "browser" }, { headers: noStore });
  let raw: string;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return Response.json({ error: "Workspace is too large." }, { status: 413, headers: noStore });
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  }
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: noStore }); }
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return Response.json({ error: "Workspace data is invalid." }, { status: 400, headers: noStore });

  const supabase = await serverSupabase();
  const { error } = await supabase.from("tflash_workspaces").upsert({
    user_id: principal.id,
    workspace: parsed.data,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return Response.json({ error: "Could not save workspace to the signed-in account." }, { status: 503, headers: noStore });
  return Response.json({ ok: true, storage: "cloud" }, { headers: noStore });
}