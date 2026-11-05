/**
 * Absolute public origin used for canonical links, Open Graph and Twitter
 * cards.
 *
 * Precedence matches `internalOrigin()`: an explicit `APP_URL` wins, then the
 * host a Vercel deployment injects as `VERCEL_URL`. Both are operator
 * controlled; neither is the untrusted incoming `Host` header, so a spoofed
 * request cannot rewrite the site's canonical URL.
 *
 * `VERCEL_URL` is a bare host (`project-abc.vercel.app`), while `APP_URL` is a
 * full URL and may include a base path for a subdirectory deployment.
 */
function normalizedSiteUrl(candidate: string | undefined, assumeHttps: boolean): string | null {
  const value = candidate?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(assumeHttps && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? `https://${value}` : value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * The deployment's public URL. Falls back to localhost so `next dev` still
 * emits usable absolute metadata instead of failing the build.
 */
export function publicSiteUrl(): string {
  return normalizedSiteUrl(process.env.APP_URL, false)
    ?? normalizedSiteUrl(process.env.VERCEL_URL, true)
    ?? "http://localhost:3000";
}
