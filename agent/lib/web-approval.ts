import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import { hasWebGrant, type PermissionOwner } from "@/lib/permission-store";
export function permissionOwner(
  session: ApprovalContext["session"],
): PermissionOwner | undefined {
  const current = session.auth.current,
    initiator = session.auth.initiator;
  if (
    !current ||
    !initiator ||
    current.principalType !== "user" ||
    initiator.principalType !== "user" ||
    current.principalId !== initiator.principalId ||
    current.authenticator !== initiator.authenticator ||
    current.issuer !== initiator.issuer
  )
    return undefined;
  const kind =
    current.authenticator === "supabase"
      ? "supabase"
      : current.authenticator === "better-auth:vercel"
        ? "vercel"
        : undefined;
  return kind && current.principalId && session.id
    ? { kind, id: current.principalId, sessionId: session.id }
    : undefined;
}
export async function webApproval(
  ctx: ApprovalContext,
): Promise<ApprovalStatus> {
  ctx.abortSignal.throwIfAborted();
  if (!ctx.session) return "user-approval";
  const owner = permissionOwner(ctx.session);
  if (!owner) return "user-approval";
  try {
    return (await hasWebGrant(
      owner,
      (ctx.toolInput as { url?: unknown } | undefined)?.url,
      ctx.abortSignal,
    ))
      ? "not-applicable"
      : "user-approval";
  } catch {
    ctx.abortSignal.throwIfAborted();
    return "user-approval";
  }
}
