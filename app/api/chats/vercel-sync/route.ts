import { z } from "zod";
import { currentPrincipal } from "@/lib/identity";
import { readBoundedJson } from "@/lib/bounded-json";
import { verifyChatOwnership } from "@/lib/security/chat-ownership";
import { importVercelHistory, listVercelHistory, vercelHistoryEnabled } from "@/lib/vercel-history-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const entry = z.object({
  id:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/), title:z.string().trim().min(1).max(120),
  updatedAt:z.number().int().min(0).max(4102444800000), proof:z.string().min(1).max(128),
}).strict();

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error:"Same-origin request required." },{status:403,headers});
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error:"Expected JSON." },{status:415,headers});
  const principal=await currentPrincipal();
  if (!principal) return Response.json({ error:"Sign in to continue." },{status:401,headers});
  if (request.headers.get("x-tflash-expected-user-id") !== principal.id || request.headers.get("x-tflash-expected-account-kind") !== principal.kind) {
    return Response.json({ error:"Account changed. Reload to continue." },{status:409,headers});
  }
  if (principal.kind !== "vercel" || !vercelHistoryEnabled()) return Response.json({ error:"Account sync unavailable." },{status:404,headers});
  const body=await readBoundedJson(request,64*1024);
  if (!body.ok) return Response.json({error:body.error},{status:body.status,headers});
  const parsed=z.object({chats:z.array(entry).max(100)}).strict().safeParse(body.value);
  if (!parsed.success || parsed.data.chats.some(chat=>!verifyChatOwnership(principal.id,chat.id,chat.proof))) {
    return Response.json({error:"Cannot verify local conversations; local data was kept."},{status:400,headers});
  }
  try {
    await importVercelHistory(principal.id,parsed.data.chats);
    return Response.json({storage:"account",chats:await listVercelHistory(principal.id)},{headers});
  } catch { return Response.json({error:"Could not sync conversations; local data was kept."},{status:503,headers}); }
}
