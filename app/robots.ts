import type { MetadataRoute } from "next";

/**
 * Only the public front door is crawlable. Conversations, APIs, auth
 * callbacks and Eve routes all require an owner and must stay out of indexes.
 * The landing page itself carries the marketing copy, so search engines no
 * longer need to be shut out of `/`.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: ["/s", "/api/", "/auth/", "/eve/", "/.well-known/"],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
