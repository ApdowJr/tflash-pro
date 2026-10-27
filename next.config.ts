import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Skip repeating codegen-time typechecking on every deployment build.
  typescript: { ignoreBuildErrors: true },
  // Arena/browser previews are served from a generated e2b.app origin. Allow
  // Next's dev server to serve assets and HMR to that origin.
  allowedDevOrigins: ["*.e2b.app"],
};

export default withEve(nextConfig);
