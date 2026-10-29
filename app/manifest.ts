import type { MetadataRoute } from "next";

/**
 * Installable-app metadata. Deliberately minimal: no service worker is
 * registered, so this does not add offline caching of conversations (that would
 * risk stale transcripts and shared-device data). It only gives the app a name,
 * colors and icon when installed to a home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tflash",
    short_name: "Tflash",
    description: "A focused AI workspace for chat and your connected tools.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdfcfb",
    theme_color: "#fdfcfb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
