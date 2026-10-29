import type { MetadataRoute } from "next";

/**
 * Conversations are private and every chat route requires an authenticated
 * owner, so nothing behind `/s/` or `/api/` should be indexed or crawled.
 * There is no public marketing surface to advertise in a sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/login"],
        disallow: ["/", "/s/", "/api/", "/auth/", "/eve/"],
      },
    ],
  };
}
