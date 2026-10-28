import { callbackSupabase } from "@/lib/supabase/callback";
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
  if (code) {
    try {
      const staged = await callbackSupabase();
      const { data, error } = await staged.supabase.auth.exchangeCodeForSession(code, callbackFlowOptions(url));
      if (!error && data.session) {
        // auth-js returns redirectType for PKCE exchanges, although its public
        // AuthTokenResponse type omits that documented field.
        if ("redirectType" in data && data.redirectType === "recovery") {
          // Only a password recovery flow needs to retain the exchanged session.
          await staged.commitRecovery();
          return redirectTo("/auth/reset-password");
        }

        // Links from an older signup template may still be in inboxes. Confirm
        // the email, but never give their temporary session to the browser.
        // Commit PKCE cleanup first: signOut also clears unrelated pending flow
        // verifiers, and those later staged writes must not reach the browser.
        await staged.commitVerifiers();
        try { await staged.supabase.auth.signOut({ scope: "local" }); } catch { /* best effort */ }
        const next = safeLocalPath(url.searchParams.get("next"));
        const query = new URLSearchParams({ confirmed: "1" });
        if (next !== "/") query.set("next", next);
        return redirectTo(`/login?${query}`);
      }
    } catch {
      // A failed or unreachable Auth service should not leave a callback 500.
    }
  }
  return redirectTo("/login?error=auth_link");
}
