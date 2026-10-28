import { createHash } from "node:crypto";
import { parseCookies } from "better-auth/cookies";
import { symmetricDecodeJWT } from "better-auth/crypto";
import { auth, authConfigured } from "@/lib/auth";

export type AppPrincipal = {
  readonly id: string;
  readonly kind: "supabase" | "vercel";
  readonly email: string;
  readonly name: string;
  readonly image?: string;
};

/** Read the Better Auth account cookie, including its supported chunk format. */
function accountCookie(headers: Headers, name: string): string | undefined {
  const cookies = parseCookies(headers.get("cookie") ?? "");
  const single = cookies.get(name);
  if (single) return single;
  const chunks = [...cookies.entries()]
    .filter(([key]) => key.startsWith(`${name}.`) && /^\d+$/.test(key.slice(name.length + 1)))
    .map(([key, value]) => ({ index: Number(key.slice(name.length + 1)), value }))
    .sort((a, b) => a.index - b.index);
  if (!chunks.length || chunks.length > 16 || chunks.some((chunk, i) => chunk.index !== i)) return undefined;
  const value = chunks.map((chunk) => chunk.value).join("");
  return value.length <= 32_000 ? value : undefined;
}

/**
 * Better Auth is configured without a database, so its generated user.id can
 * change after another login. Use the immutable Vercel account ID from its
 * authenticated, encrypted account cookie instead; bind it to the verified
 * Better Auth session before using it as an app principal.
 */
export async function vercelPrincipal(requestHeaders: Headers): Promise<AppPrincipal | null> {
  if (!authConfigured) return null;
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session?.user?.id) return null;
    const context = await auth.$context;
    const cookie = accountCookie(requestHeaders, context.authCookies.accountData.name);
    if (!cookie || cookie.length > 32_000) return null;
    const account = await symmetricDecodeJWT<{ providerId?: unknown; accountId?: unknown; userId?: unknown }>(
      cookie, context.secretConfig, "better-auth-account",
    );
    if (!account || account.providerId !== "vercel" || account.userId !== session.user.id ||
      typeof account.accountId !== "string" || !account.accountId || account.accountId.length > 512) return null;
    const stableId = createHash("sha256").update(account.accountId).digest("hex");
    return {
      id: `vercel:${stableId}`,
      kind: "vercel",
      email: session.user.email ?? "",
      name: session.user.name || session.user.email?.split("@")[0] || "Member",
      ...(session.user.image ? { image: session.user.image } : {}),
    };
  } catch {
    return null;
  }
}
