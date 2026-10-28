import { serverSupabase } from "@/lib/supabase/server";
import { safeLocalPath } from "@/lib/security/redirect";
import { callbackFlowOptions } from "@/lib/supabase/pkce";

// Relative Location keeps the browser on the public origin, even when Next
// runs behind a proxy or binds to 0.0.0.0. It also avoids trusting Host headers.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeLocalPath(url.searchParams.get("next"));
  if (code) {
    try {
      const supabase = await serverSupabase();
      const { error } = await supabase.auth.exchangeCodeForSession(code, callbackFlowOptions(url));
      if (!error) return redirectTo(next);
    } catch {
      // A failed or unreachable Auth service should not leave a callback 500.
    }
  }
  return redirectTo("/login?error=auth_link");
}
