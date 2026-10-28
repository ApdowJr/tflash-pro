/** An operator-controlled origin, never the untrusted incoming Host header. */
export function internalOrigin(): string {
  const configured = process.env.TFLASH_INTERNAL_ORIGIN;
  const candidate = configured || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NODE_ENV === "development"
      ? `http://127.0.0.1:${process.env.PORT || "3000"}`
      : process.env.APP_URL);
  if (!candidate) throw new Error("Set APP_URL or TFLASH_INTERNAL_ORIGIN for the eve service.");
  const url = new URL(candidate);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid internal origin.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("The production internal origin must use HTTPS.");
  }
  return url.origin;
}

/** Credentials for an operator-controlled internal Eve origin. A Vercel
 * deployment protected by Vercel Authentication needs this server-only bypass
 * on the Next-to-Eve request. Never trust or forward a client-provided value. */
export function internalEveHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.delete("x-vercel-protection-bypass");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  return headers;
}
