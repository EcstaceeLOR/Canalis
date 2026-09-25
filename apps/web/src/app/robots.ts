import type { MetadataRoute } from "next";
import { CANONICAL_SITE_URL } from "../lib/release";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/tasks",
        "/channels",
        "/providers",
        "/transactions",
        "/policies",
        "/analytics",
        "/activity",
        "/settings",
        "/onboarding",
      ],
    },
    sitemap: `${CANONICAL_SITE_URL}/sitemap.xml`,
    host: CANONICAL_SITE_URL,
  };
}
