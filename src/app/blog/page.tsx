import Link from "next/link";
import { posts } from "./posts";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research Match Blog - How to Find and Land Undergraduate Research",
  description: "Guides, tips, and real stories about finding professors, writing cold emails, and landing research positions as a student.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Research Match Blog - How to Find and Land Undergraduate Research",
    description: "Guides, tips, and real stories about finding professors, writing cold emails, and landing research positions as a student.",
    type: "website",
    siteName: "Research Match",
  },
};

const CATEGORIES: { label: string; slugs: string[] }[] = [
  {
    label: "Finding Professors",
    slugs: [
      "how-to-find-research-positions",
      "how-to-find-research-opportunities",
      "how-to-get-research-experience-undergrad",
      "research-opportunities-for-early-stage-students",
      "how-to-find-a-research-mentor",
      "summer-research-opportunities",
      "undergraduate-research-benefits",
    ],
  },
  {
    label: "Writing the Email",
    slugs: [
      "how-to-email-a-professor",
      "how-to-email-a-research-professor",
      "how-to-cold-email-a-professor",
      "how-to-email-a-professor-about-research",
      "cold-email-professor-template",
      "research-interest-statement",
      "best-time-to-email-professors",
      "cold-email-vs-warm-intro",
    ],
  },
  {
    label: "After You Send",
    slugs: [
      "how-to-follow-up-with-a-professor",
      "do-professors-respond-to-cold-emails",
      "what-professors-look-for-in-research-students",
      "professor-said-no-funding-should-i-still-ask-to-join",
    ],
  },
  {
    label: "Common Mistakes",
    slugs: [
      "cold-email-mistakes",
    ],
  },
  {
    label: "Specific Goals",
    slugs: [
      "premed-research-experience",
      "research-experience-for-phd-applications",
    ],
  },
];

export default function BlogIndex() {
  return (
    <div className="blog-shell blog-index-shell">
      <div className="blog-index-container">
        <nav className="blog-nav">
          <Link href="/" className="blog-brand">
            Research Match
          </Link>
          <Link href="/app" className="blog-green-button blog-nav-button">
            Open Tool
          </Link>
        </nav>

        <header className="blog-index-hero">
          <p className="blog-kicker">Research Match Library</p>
          <h1>
            The Complete Guide to Getting Undergraduate Research
          </h1>
          <div>
          <p>
            Getting research experience as an undergrad is one of the best things you can do for grad school, med school, or just figuring out what you actually want to do. But nobody teaches you how to do it.
          </p>
          <p>
            Most students either wait around for a posting that never comes or send a generic cold email that gets deleted in two seconds. Neither works. What works is knowing how to find the right professor, writing an email that sounds like a human wrote it, and following up without being annoying.
          </p>
          <p>
            These guides cover the whole process from scratch. Start with finding professors if you have no idea where to look, or jump straight to the email guides if you just need help with what to actually say.
          </p>
          </div>
          <Link href="/app?source=blog-index" className="blog-green-button blog-index-cta">
            Find professor matches
          </Link>
        </header>

        {CATEGORIES.map((cat) => {
          const catPosts = cat.slugs
            .map((slug) => posts.find((p) => p.slug === slug))
            .filter(Boolean) as typeof posts;
          if (catPosts.length === 0) return null;
          return (
            <section key={cat.label} className="blog-category">
              <h2>
                {cat.label}
              </h2>
              <div className="blog-card-list">
                {catPosts.map((post) => (
                  <Link
                    key={post.slug}
                    href={`/blog/${post.slug}`}
                    className="blog-index-card"
                  >
                    <h3>
                      {post.title}
                    </h3>
                    <p>
                      {post.description}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <div className="blog-index-bottom-cta">
          <p>Ready to turn the guides into a shortlist?</p>
          <Link href="/app?source=blog-index-footer" className="blog-green-button">
            Search professors free
          </Link>
        </div>
      </div>
    </div>
  );
}
