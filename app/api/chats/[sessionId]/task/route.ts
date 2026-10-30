import { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
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
  const body = await readBoundedJson(req);
  if (!body.ok) return reply({ error: body.error }, body.status);
  const p = z.object({ task: taskDefinitionSchema, expectedRevision: z.uuid().nullable() }).strict().safeParse(body.value);
  if (!p.success) return reply({ error: "Invalid task." }, 400);
  try {
    if (!await setTask(o, p.data.task, p.data.expectedRevision)) return reply({ error: "Task changed elsewhere; refresh before replacing it." }, 409);
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
  const body = await readBoundedJson(req);
  if (!body.ok) return reply({ error: body.error }, body.status);
  const parsed = z.object({ expectedRevision: z.uuid() }).strict().safeParse(body.value);
  if (!parsed.success) return reply({ error: "Invalid task revision." }, 400);
  try {
    if (
      !(await settleTask(o, parsed.data.expectedRevision, "cancelled", "Cancelled by the user."))
    )
      return reply({ error: "Task changed; refresh." }, 409);
    return reply({ task: await getTask(o) });
  } catch {
    return reply({ error: "Task storage unavailable." }, 503);
  }
}
