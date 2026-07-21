import Link from "next/link";
import type { Metadata } from "next";
import { getAllFieldContent } from "@/lib/research-data";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-static";
export const revalidate = false;

const SITE = siteOrigin();

export const metadata: Metadata = {
  title: "Research Fields: Find Professors by Subject",
  description:
    "Browse research fields to find professors who are actively publishing, understand their work, and email them about a research position.",
  alternates: { canonical: `${SITE}/research` },
  openGraph: {
    title: "Research Fields: Find Professors by Subject",
    description:
      "Browse research fields to find professors who are actively publishing and learn how to email them about a research position.",
    type: "website",
    url: `${SITE}/research`,
    siteName: "Research Match",
  },
};

export default async function ResearchIndexPage() {
  const fields = await getAllFieldContent();

  return (
    <div className="blog-shell">
      <div className="blog-index-container">
        <nav className="blog-nav">
          <Link href="/" className="blog-brand">Research Match</Link>
          <div className="blog-nav-links">
            <Link href="/blog" className="blog-nav-link">Blog</Link>
            <Link href="/app" className="blog-green-button blog-nav-button">Open Tool</Link>
          </div>
        </nav>

        <header className="blog-article-hero">
          <p className="blog-kicker">Research Field Guides</p>
          <h1 className="blog-title">Find a research position by field</h1>
          <p className="blog-description">
            Pick your field to see professors who are actively publishing in it, what they
            work on, and exactly how to email them.
          </p>
        </header>

        {fields.length > 0 ? (
          <div className="rm-research-index-grid">
            {fields.map((f) => (
              <Link key={f.field_slug} href={`/research/${f.field_slug}`} className="rm-research-index-card">
                <h2>{f.field_name}</h2>
                <p>{f.meta_description}</p>
                <span className="rm-research-index-cta">See {f.field_name} professors →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="blog-description">Field guides are being prepared. Check back soon.</p>
        )}

        <div className="blog-footer">
          <Link href="/">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}
