import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { AuthScreen } from "@/components/app/auth-screen";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <AuthScreen />;
}
