import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./config";

/** Framework-neutral SSR client used inside the separately hosted eve agent. */
export function requestSupabase(request: Request) {
  const incoming = parseCookieHeader(request.headers.get("cookie") ?? "");
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => incoming,
      // Next's proxy refreshes cookies before the request reaches eve.
      setAll: () => {},
    },
  });
}
