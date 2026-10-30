import { redirect } from "next/navigation";
import { currentPrincipal } from "@/lib/identity";
import { authConfigured } from "@/lib/auth";
import { AuthScreen } from "@/components/app/auth-screen";

export default async function LoginPage({ searchParams }: {
  readonly searchParams: Promise<{ readonly mode?: string | string[] }>;
}) {
  if (await currentPrincipal()) redirect("/");
  const { mode } = await searchParams;
  const initialMode = mode === "signup" ? "signup" : "signin";
  return <AuthScreen initialMode={initialMode} vercelAvailable={authConfigured} />;
}
