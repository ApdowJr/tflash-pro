import { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import { ownedChat } from "@/lib/security/owned-chat";
import { continuationMutation, pendingContinuation, reviewedContinuations } from "@/lib/continuation-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
type Context = { params: Promise<{ sessionId: string }> };
async function owner(req: Request, ctx: Context) {
  const { sessionId } = await ctx.params;
  const o = await ownedChat(req, sessionId);
  return o ? { kind: o.kind, id: o.userId, sessionId } : null;
}
export async function GET(req: Request, ctx: Context) {
  const o = await owner(req, ctx);
  if (!o) return reply({ error: "Conversation not available." }, 404);
  try {
    const [attempt, history] = await Promise.all([pendingContinuation(o, req.signal), reviewedContinuations(o, req.signal)]);
    return reply({ attempt, history });
  }
  catch { return reply({ error: "Continuation storage unavailable." }, 503); }
}
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), attemptId: z.uuid(), revision: z.uuid() }).strict(),
  z.object({ action: z.literal("begin"), attemptId: z.uuid() }).strict(),
  z.object({ action: z.literal("hold"), attemptId: z.uuid(), expectedRevision: z.uuid(), note: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("resolve"), attemptId: z.uuid(), expectedRevision: z.uuid(), reviewed: z.literal(true), note: z.string().trim().min(10).max(1000) }).strict(),
]);
export async function POST(req: Request, ctx: Context) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return reply({ error: "Same-origin request required." }, 403);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Expected JSON." }, 415);
  const o = await owner(req, ctx);
  if (!o) return reply({ error: "Conversation not available." }, 404);
  const body = await readBoundedJson(req);
  if (!body.ok) return reply({ error: body.error }, body.status);
  const p = input.safeParse(body.value);
  if (!p.success) return reply({ error: "Invalid continuation request." }, 400);
  try {
    const ok = await continuationMutation(o, p.data.action, p.data.attemptId, p.data.action === "reserve" ? p.data.revision : p.data.action === "hold" || p.data.action === "resolve" ? p.data.expectedRevision : undefined, p.data.action === "hold" || p.data.action === "resolve" ? p.data.note : undefined, req.signal);
    return ok ? reply({ ok: true }) : reply({ error: "Continuation changed; refresh and review." }, 409);
  } catch { return reply({ error: "Continuation state unconfirmed. Refresh and review before trying again." }, 503); }
}
