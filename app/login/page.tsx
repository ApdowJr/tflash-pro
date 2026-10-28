import { redirect } from "next/navigation";
import { currentPrincipal } from "@/lib/identity";
import { authConfigured } from "@/lib/auth";
import { AuthScreen } from "@/components/app/auth-screen";

export default async function LoginPage() {
  if (await currentPrincipal()) redirect("/");
  return <AuthScreen vercelAvailable={authConfigured} />;
}
