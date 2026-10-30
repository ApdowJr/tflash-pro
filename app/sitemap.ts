import type { MetadataRoute } from "next";

/**
 * The public surface is deliberately small: the landing page and sign-in.
 * Absolute URLs need the deployment's public origin; without `APP_URL` the
 * sitemap is empty rather than advertising a guessed domain.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!base) return [];
  const lastModified = new Date("2026-10-30T00:00:00.000Z");
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, lastModified, changeFrequency: "monthly", priority: 0.4 },
  ];
}
