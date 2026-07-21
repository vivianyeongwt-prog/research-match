import type { MetadataRoute } from "next";
import { posts } from "./blog/posts";
import { getPopulatedFieldSlugs } from "@/lib/research-data";
import { siteOrigin } from "@/lib/site-url";

const SITE = siteOrigin();

// Dynamic sitemap: the previously hand-maintained URLs PLUS every generated
// /research field page, added automatically. Replaces the old static
// public/sitemap.xml (removed) so new field pages need no manual sitemap edits.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const main: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/app`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/research`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/examples`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/framework`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/follow-up`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE}/feedback`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const blog: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.datePublished,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  let research: MetadataRoute.Sitemap = [];
  try {
    const slugs = await getPopulatedFieldSlugs();
    const now = new Date();
    research = slugs.map((slug) => ({
      url: `${SITE}/research/${slug}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    }));
  } catch {
    // If the DB isn't reachable at build, ship the rest of the sitemap anyway.
    research = [];
  }

  return [...main, ...blog, ...research];
}
