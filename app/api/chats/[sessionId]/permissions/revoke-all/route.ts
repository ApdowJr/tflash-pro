import { ownedChat } from "@/lib/security/owned-chat";
import { revokeAllWeb } from "@/lib/permission-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return reply({ error: "Same-origin request required." }, 403);
  const { sessionId } = await ctx.params;
  const owner = await ownedChat(req, sessionId);
  if (!owner) return reply({ error: "Conversation not available." }, 404);
  try {
    await revokeAllWeb({ kind: owner.kind, id: owner.userId, sessionId });
    return reply({ revoked: true });
  } catch {
    return reply({ error: "Could not confirm revocation. Grants may still be active." }, 503);
  }
}
