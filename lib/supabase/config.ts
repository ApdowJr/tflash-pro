/** Public project configuration. The publishable key is deliberately safe for
 * browser use; database access is constrained by Supabase RLS. An explicit
 * Tflash pair takes precedence over provider-managed NEXT_PUBLIC_* variables. */
const overrideUrl = process.env.NEXT_PUBLIC_TFLASH_SUPABASE_URL;
const overrideKey = process.env.NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY;
const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (Boolean(overrideUrl) !== Boolean(overrideKey)) {
  throw new Error("Configure both NEXT_PUBLIC_TFLASH_SUPABASE_URL and NEXT_PUBLIC_TFLASH_SUPABASE_PUBLISHABLE_KEY together.");
}
if (!overrideUrl && Boolean(configuredUrl) !== Boolean(configuredKey)) {
  throw new Error("Configure both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY together.");
}

export const supabaseUrl = overrideUrl || configuredUrl || "https://uatpsywxzdkdjhbclzve.supabase.co";
export const supabasePublishableKey =
  overrideKey || configuredKey || "sb_publishable_kLQJ82DtLOu3XjNecH6Qpw_fvVRCOy6";
