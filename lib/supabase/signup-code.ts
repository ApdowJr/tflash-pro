"use client";

import { createClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

let verificationAttempt = 0;

/**
 * Supabase returns an authenticated session when an OTP is verified. Keep it
 * isolated in memory rather than the app's cookie-backed client: confirmation
 * must return the user to password sign-in, not silently sign them in.
 */
export async function verifySignupCode(email: string, token: string): Promise<
  { ok: true } | { ok: false; reason: "invalid" | "unavailable" }
> {
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      // A separate key avoids sharing state or notifications with the normal
      // SSR browser client, even if several verification attempts are made.
      storageKey: `tflash-signup-verification-${++verificationAttempt}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.verifyOtp({ email, token, type: "signup" });
  if (error) {
    const invalid = error.code === "otp_expired" || [400, 403, 422].includes(error.status ?? 0);
    return { ok: false, reason: invalid ? "invalid" : "unavailable" };
  }
  if (!data.user || !data.session?.access_token) return { ok: false, reason: "unavailable" };

  // This revokes the temporary session when possible. Even if logout fails,
  // it remains isolated in this in-memory client and is never set as an app
  // cookie or returned to the caller.
  try { await client.auth.signOut({ scope: "local" }); } catch { /* best effort */ }
  return { ok: true };
}
