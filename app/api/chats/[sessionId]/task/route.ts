import { ownedChat } from "@/lib/security/owned-chat";
import { taskDefinitionSchema } from "@/lib/tracked-task";
import { getTask, setTask, settleTask } from "@/lib/tracked-task-store";
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
    return reply({ task: await getTask(o) });
  } catch {
    return reply({ error: "Task storage unavailable." }, 503);
  }
}
export async function PUT(req: Request, ctx: Context) {
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
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid JSON." }, 400);
  }
  const p = taskDefinitionSchema.safeParse(data);
  if (!p.success) return reply({ error: "Invalid task." }, 400);
  try {
    await setTask(o, p.data);
    return reply({ task: await getTask(o) });
  } catch {
    return reply({ error: "Task storage unavailable." }, 503);
  }
}
export async function DELETE(req: Request, ctx: Context) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return reply({ error: "Same-origin request required." }, 403);
  const o = await ownerFor(req, ctx);
  if (!o) return reply({ error: "Conversation not available." }, 404);
  try {
    const t = await getTask(o);
    if (!t || t.state !== "awaiting_evidence")
      return reply({ error: "No active tracked task." }, 409);
    if (
      !(await settleTask(o, t.revision, "cancelled", "Cancelled by the user."))
    )
      return reply({ error: "Task changed; refresh." }, 409);
    return reply({ task: await getTask(o) });
  } catch {
    return reply({ error: "Task storage unavailable." }, 503);
  }
}
