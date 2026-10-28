/** Public project configuration. The publishable key is deliberately safe for
 * browser use; database access is constrained by Supabase RLS. Deployments can
 * point to a different Supabase project via the NEXT_PUBLIC_* variables. */
export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uatpsywxzdkdjhbclzve.supabase.co";
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_kLQJ82DtLOu3XjNecH6Qpw_fvVRCOy6";
