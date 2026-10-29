import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Arena/browser previews are served from a generated e2b.app origin. Allow
  // Next's dev server to serve assets and HMR to that origin.
  serverExternalPackages: ["pdfjs-dist", "yauzl", "saxes", "docx", "pdf-lib", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/api/documents/*": ["./lib/documents/parse-worker.mjs", "./assets/fonts/*", "./node_modules/pdfjs-dist/**/*", "./node_modules/yauzl/**/*", "./node_modules/saxes/**/*"],
  },
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
};

export default withEve(nextConfig);
