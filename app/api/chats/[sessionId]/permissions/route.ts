import { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import { ownedChat } from "@/lib/security/owned-chat";
import { homepageOrigin } from "@/lib/permission-scope";
import { changeWebGrant, listWebGrants, permissionEpoch } from "@/lib/permission-store";
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
  if (!o) return reply({ error: "Conversation not available.", changeNotStarted: true }, 404);
  try {
    const epoch = await permissionEpoch(o);
    return reply({ epoch, grants: await listWebGrants(o) });
  } catch {
    return reply(
      { error: "Cannot confirm permissions. Existing grants may still apply." },
      503,
    );
  }
}
async function change(req: Request, ctx: Context, revoke: boolean) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return reply({ error: "Same-origin request required.", changeNotStarted: true }, 403);
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return reply({ error: "Expected JSON.", changeNotStarted: true }, 415);
  const o = await ownerFor(req, ctx);
  if (!o) return reply({ error: "Conversation not available.", changeNotStarted: true }, 404);
  const body = await readBoundedJson(req);
  if (!body.ok) return reply({ error: body.error, changeNotStarted: true }, body.status);
  const parsed = z.object({ origin: z.string(), expectedRevision: z.uuid().nullable(), expectedEpoch: z.uuid() }).strict().safeParse(body.value);
  if (!parsed.success || (revoke && parsed.data.expectedRevision === null)) return reply({ error: "Invalid scope or revision.", changeNotStarted: true }, 400);
  const origin = homepageOrigin(parsed.data.origin);
  if (!origin)
    return reply(
      { error: "Enter an HTTPS homepage without path or query.", changeNotStarted: true },
      400,
    );
  try {
    if (!await changeWebGrant(o, origin, parsed.data.expectedRevision, parsed.data.expectedEpoch, revoke)) return reply({ error: "Permissions changed; refresh before trying again.", changeNotStarted: true }, 409);
    return reply({ epoch: await permissionEpoch(o), grants: await listWebGrants(o) });
  } catch {
    return reply(
      { error: "Cannot confirm permissions. Existing grants may still apply." },
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
