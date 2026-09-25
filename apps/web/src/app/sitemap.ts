import type { MetadataRoute } from "next";
import { CANONICAL_SITE_URL } from "../lib/release";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: CANONICAL_SITE_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
