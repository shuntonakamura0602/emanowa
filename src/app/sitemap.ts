import type { MetadataRoute } from "next";

import type { PublicRuntimeConfig } from "@/config/public";
import { getPublicRuntimeConfig } from "@/server/config";

export function createSitemapMetadata(
  config: PublicRuntimeConfig,
): MetadataRoute.Sitemap {
  if (
    config.environment !== "production" ||
    !config.publication.ready ||
    !config.appOrigin
  ) {
    return [];
  }

  const entries = [
    { path: "", changeFrequency: "weekly", priority: 1 },
    { path: "/about", changeFrequency: "yearly", priority: 0.5 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
    {
      path: `/w/${encodeURIComponent(config.featuredWorld.slug)}`,
      changeFrequency: "daily",
      priority: 0.9,
    },
  ] as const;

  return entries.map(({ path, changeFrequency, priority }) => ({
    url: `${config.appOrigin}${path}`,
    changeFrequency,
    priority,
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return createSitemapMetadata(getPublicRuntimeConfig());
}
