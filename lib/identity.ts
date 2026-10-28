import { headers } from "next/headers";
import { vercelPrincipal, type AppPrincipal } from "@/lib/auth-vercel";
import { currentUser } from "@/lib/supabase/server";

export type { AppPrincipal } from "@/lib/auth-vercel";

/** Only verified sessions establish an app identity; Supabase wins if both cookies exist. */
export async function currentPrincipal(): Promise<AppPrincipal | null> {
  const user = await currentUser();
  if (user) {
    const name = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : user.email?.split("@")[0] || "Member";
    return { id: user.id, kind: "supabase", email: user.email ?? "", name };
  }
  return vercelPrincipal(new Headers(await headers()));
}
