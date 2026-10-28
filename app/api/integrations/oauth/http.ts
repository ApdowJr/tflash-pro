/**
 * Shared helpers for the OAuth routes: where this deployment lives, and how to
 * bounce the browser back to the app with a short status code.
 */

/** Canonical app origin. `APP_URL` wins so the redirect URI stays stable. */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//.test(configured)) return configured;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function callbackUrl(request: Request): string {
  return `${appOrigin(request)}/api/integrations/oauth/callback`;
}

/** Back to the app with a machine-readable result (never a raw token). */
export function backToApp(
  request: Request,
  params: Readonly<Record<string, string>>,
): Response {
  const url = new URL("/", appOrigin(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}
