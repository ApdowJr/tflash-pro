import type { NextConfig } from "next";
import { withEve } from "eve/next";

/**
 * Security headers.
 *
 * Deliberately absent:
 * - `X-Frame-Options` / `frame-ancestors`: the app is embedded in the preview
 *   iframe of its host, and any fixed ancestor list would break that.
 * - `Content-Security-Policy`: Next injects inline bootstrap scripts and the
 *   chat renders AI-authored Markdown. A correct CSP needs per-request nonces
 *   and a review of every remote origin; shipping a loose one would create a
 *   false sense of protection. Track it as its own change.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Voice input needs the microphone for this origin only; nothing else.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=()",
  },
  // Keep OAuth popups (provider/integration consent) able to talk back while
  // isolating the opener from unrelated documents.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Arena/browser previews are served from a generated e2b.app origin. Allow
  // Next's dev server to serve assets and HMR to that origin.
  serverExternalPackages: ["pdfjs-dist", "yauzl", "saxes", "docx", "pdf-lib", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/api/documents/*": ["./lib/documents/parse-worker.mjs", "./assets/fonts/*", "./node_modules/pdfjs-dist/**/*", "./node_modules/yauzl/**/*", "./node_modules/saxes/**/*"],
  },
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withEve(nextConfig);
