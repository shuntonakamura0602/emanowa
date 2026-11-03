import type { MetadataRoute } from "next";

import type { PublicRuntimeConfig } from "@/config/public";
import { getPublicRuntimeConfig } from "@/server/config";

export function createRobotsMetadata(
  config: PublicRuntimeConfig,
): MetadataRoute.Robots {
  if (
    config.environment !== "production" ||
    !config.publication.ready ||
    !config.appOrigin
  ) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/me", "/w/*/new", "/w/*/e/*/edit"],
    },
    sitemap: `${config.appOrigin}/sitemap.xml`,
    host: config.appOrigin,
  };
}

export default function robots(): MetadataRoute.Robots {
  return createRobotsMetadata(getPublicRuntimeConfig());
}
