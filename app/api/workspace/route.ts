import { currentPrincipal } from "@/lib/identity";
import { serverSupabase } from "@/lib/supabase/server";
import { workspaceSchema } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 200_000;
const EXPECTED_USER_HEADER = "x-tflash-expected-user-id";
const CONFLICT_MESSAGE = "Workspace changed elsewhere. Choose which copy to keep before syncing.";

function conflictResponse(): Response {
  return Response.json({ error: CONFLICT_MESSAGE }, { status: 409, headers: noStore });
}

function nextUpdatedAt(expectedUpdatedAt: string | null): string {
  const previous = expectedUpdatedAt === null ? 0 : Date.parse(expectedUpdatedAt);
  return new Date(Math.max(Date.now(), previous + 1)).toISOString();
}

export async function GET(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  // Vercel identities are not Supabase JWTs and must never be mapped to a Supabase row.
  if (principal.kind !== "supabase") return Response.json({ storage: "browser", workspace: null, updatedAt: null }, { headers: noStore });
  if (request.headers.get(EXPECTED_USER_HEADER) !== principal.id) return conflictResponse();
  const supabase = await serverSupabase();
  const { data, error } = await supabase.from("tflash_workspaces")
    .select("workspace, updated_at").eq("user_id", principal.id).maybeSingle();
  if (error) return Response.json({ error: "Workspace cloud sync is unavailable." }, { status: 503, headers: noStore });
  if (!data) return Response.json({ storage: "cloud", workspace: null, updatedAt: null }, { headers: noStore });
  const parsed = workspaceSchema.safeParse(data.workspace);
  if (!parsed.success || typeof data.updated_at !== "string") {
    return Response.json({ error: "Saved workspace is invalid; local data was not overwritten." }, { status: 503, headers: noStore });
  }
  return Response.json({ storage: "cloud", workspace: parsed.data, updatedAt: data.updated_at }, { headers: noStore });
}

export async function PUT(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415, headers: noStore });
  }
  const principal = await currentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  if (principal.kind !== "supabase") return Response.json({ storage: "browser" }, { headers: noStore });
  if (request.headers.get(EXPECTED_USER_HEADER) !== principal.id) return conflictResponse();
  let raw: string;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ error: "Workspace is too large." }, { status: 413, headers: noStore });
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  }
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers: noStore }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "Workspace data is invalid." }, { status: 400, headers: noStore });
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "workspace" && key !== "expectedUpdatedAt")) {
    return Response.json({ error: "Workspace data is invalid." }, { status: 400, headers: noStore });
  }
  const parsed = workspaceSchema.safeParse(record.workspace);
  const expectedUpdatedAt = record.expectedUpdatedAt;
  if (
    !parsed.success ||
    (expectedUpdatedAt !== null &&
      (typeof expectedUpdatedAt !== "string" ||
        expectedUpdatedAt.length > 64 ||
        !Number.isFinite(Date.parse(expectedUpdatedAt))))
  ) {
    return Response.json({ error: "Workspace data is invalid." }, { status: 400, headers: noStore });
  }

  const supabase = await serverSupabase();
  const updatedAt = nextUpdatedAt(expectedUpdatedAt);
  if (expectedUpdatedAt === null) {
    const { error } = await supabase.from("tflash_workspaces").insert({
      user_id: principal.id,
      workspace: parsed.data,
      updated_at: updatedAt,
    });
    if (error?.code === "23505") return conflictResponse();
    if (error) return Response.json({ error: "Could not save workspace to the signed-in account." }, { status: 503, headers: noStore });
  } else {
    const { data, error } = await supabase.from("tflash_workspaces")
      .update({ workspace: parsed.data, updated_at: updatedAt })
      .eq("user_id", principal.id)
      .eq("updated_at", expectedUpdatedAt)
      .select("updated_at")
      .maybeSingle();
    if (error) return Response.json({ error: "Could not save workspace to the signed-in account." }, { status: 503, headers: noStore });
    if (!data) return conflictResponse();
  }
  return Response.json({ ok: true, storage: "cloud", updatedAt }, { headers: noStore });
}
