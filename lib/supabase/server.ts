import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "./config";

export async function serverSupabase() {
  const store = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Server components cannot write cookies. The proxy refreshes them.
        }
      },
    },
  });
}

/** Never trust the unverified user embedded in a cookie. */
export async function currentUser() {
  const store = await cookies();
  if (!store.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"))) {
    return null;
  }
  const supabase = await serverSupabase();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
