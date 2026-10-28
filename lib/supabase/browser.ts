"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./config";
import { browserAuthOptions } from "./pkce";

/** The SSR client stores the session in same-site cookies shared with eve. */
export function browserSupabase() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey, {
    // Distinguish concurrent confirmation/recovery links in the same browser.
    // The Supabase callback allowlist must include the callback query string.
    auth: browserAuthOptions,
  });
}
