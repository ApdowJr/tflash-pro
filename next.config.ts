import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Arena/browser previews are served from a generated e2b.app origin. Allow
  // Next's dev server to serve assets and HMR to that origin.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
};

export default withEve(nextConfig);
