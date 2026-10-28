import { timingSafeEqual } from "node:crypto";

/** OAuth callbacks must never use an untrusted Host as their redirect origin. */
export function appOrigin(request: Request): string {
  const candidates = [
    process.env.APP_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(process.env.OAUTH_ALLOWED_ORIGINS?.split(",") ?? []),
  ].filter((entry): entry is string => Boolean(entry?.trim())).map((entry) => {
    const url = new URL(entry.startsWith("http") ? entry.trim() : `https://${entry.trim()}`);
    if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("Invalid OAuth origin.");
    return url.origin;
  });
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (!/^(https?)$/.test(proto) || host.includes(",") || /[\s/@\\]/.test(host)) throw new Error("Invalid OAuth host.");
  const requested = new URL(`${proto}://${host}`);
  if (process.env.NODE_ENV === "production") {
    if (requested.protocol !== "https:" || !candidates.includes(requested.origin)) throw new Error("OAuth origin is not trusted.");
  } else if (!candidates.includes(requested.origin) &&
    requested.hostname !== "localhost" && requested.hostname !== "127.0.0.1" && !requested.hostname.endsWith(".e2b.app")) {
    throw new Error("OAuth origin is not trusted.");
  }
  return requested.origin;
}

export function callbackUrl(request: Request): string {
  return `${appOrigin(request)}/api/integrations/oauth/callback`;
}

/** Relative redirects do not inherit a potentially forged Host header. */
export function backToApp(_request: Request, params: Readonly<Record<string, string>>): Response {
  const query = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { location: `/${query ? `?${query}` : ""}`, "cache-control": "no-store" } });
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function flowCookieName(flowId: string): string {
  return `tflash-oauth-${flowId}`;
}

export function flowCookie(request: Request, flowId: string, value: string, maxAge: number): string {
  const secure = appOrigin(request).startsWith("https://") ? "; Secure" : "";
  return `${flowCookieName(flowId)}=${value}; Path=/api/integrations/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function constantTimeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
