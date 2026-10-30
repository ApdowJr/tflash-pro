import { ownedChat } from "@/lib/security/owned-chat";
import { homepageOrigin } from "@/lib/permission-scope";
import { grantWeb, listWebGrants, revokeWeb } from "@/lib/permission-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
type Context = { params: Promise<{ sessionId: string }> };
const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers });
async function ownerFor(req: Request, ctx: Context) {
  const { sessionId } = await ctx.params;
  const o = await ownedChat(req, sessionId);
  return o ? { kind: o.kind, id: o.userId, sessionId } : null;
}
export async function GET(req: Request, ctx: Context) {
  const o = await ownerFor(req, ctx);
  if (!o) return reply({ error: "Conversation not available." }, 404);
  try {
    return reply({ grants: await listWebGrants(o) });
  } catch {
    return reply(
      { error: "Permission storage unavailable; approvals remain required." },
      503,
    );
  }
}
async function change(req: Request, ctx: Context, revoke: boolean) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return reply({ error: "Same-origin request required." }, 403);
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return reply({ error: "Expected JSON." }, 415);
  const o = await ownerFor(req, ctx);
  if (!o) return reply({ error: "Conversation not available." }, 404);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  if (new TextEncoder().encode(raw).length > 4096)
    return reply({ error: "Request too large." }, 413);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid JSON." }, 400);
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("origin" in input)
  )
    return reply({ error: "Invalid scope." }, 400);
  const origin = homepageOrigin(input.origin);
  if (!origin)
    return reply(
      { error: "Enter an HTTPS homepage without path or query." },
      400,
    );
  try {
    if (revoke) await revokeWeb(o, origin);
    else await grantWeb(o, origin);
    return reply({ grants: await listWebGrants(o) });
  } catch {
    return reply(
      { error: "Permission storage unavailable; approvals remain required." },
      503,
    );
  }
}
export async function POST(req: Request, ctx: Context) {
  return change(req, ctx, false);
}
export async function DELETE(req: Request, ctx: Context) {
  return change(req, ctx, true);
}
