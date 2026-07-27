import Link from "next/link";
import { posts } from "../posts";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { siteOrigin } from "@/lib/site-url";
import { serializeJsonLd } from "@/lib/json-ld";
import { fieldsForPost } from "@/lib/research-blog-links";
import { getPopulatedFieldSlugs } from "@/lib/research-data";

const SITE = siteOrigin();

type Props = { params: Promise<{ slug: string }> };

function formatBlogDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function ctaForPost(post: (typeof posts)[number]) {
  const text = `${post.slug} ${post.title} ${post.keyword}`.toLowerCase();

  if (text.includes("email") || text.includes("cold")) {
    return {
      kicker: "Turn the guide into an email",
      title: "Find a professor and get the email angle.",
      body: "Search by interest, understand their work, and draft outreach that sounds specific.",
      button: "Find professors",
    };
  }

  if (text.includes("mentor")) {
    return {
      kicker: "Find a real mentor fit",
      title: "Find mentors worth emailing.",
      body: "Compare professors by recent work and build a focused shortlist before you reach out.",
      button: "Find mentors",
    };
  }

  if (text.includes("summer") || text.includes("premed") || text.includes("phd")) {
    return {
      kicker: "Build your research plan",
      title: "Build a professor shortlist today.",
      body: "Find labs aligned with your goal and see which professors deserve a thoughtful email first.",
      button: "Build my shortlist",
    };
  }

  return {
    kicker: "Go from reading to reaching out",
    title: "Find professors who match your interests.",
    body: "Search a topic, understand recent work, and turn strong matches into outreach.",
    button: "Find matches",
  };
}

function articleContent(post: (typeof posts)[number]) {
  return post.content.replace(/\s*<div class="blog-cta">[\s\S]*?<\/div>\s*$/, "");
}

export async function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) return {};
  return {
    title: `${post.title} | Research Match`,
    description: post.description,
    keywords: post.keyword,
    authors: [{ name: "Jace" }],
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url: `${SITE}/blog/${post.slug}`,
      publishedTime: post.datePublished,
      authors: ["Jace"],
      siteName: "Research Match",
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) notFound();

  const relatedPosts = post.relatedSlugs
    .map((s) => posts.find((p) => p.slug === s))
    .filter(Boolean);
  const cta = ctaForPost(post);
  const relatedFields = fieldsForPost(post.slug, await getPopulatedFieldSlugs());

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    author: {
      "@type": "Person",
      name: "Jace",
      description: "15-year-old founder of Research Match. I've cold emailed professors at Princeton, ASU, and dozens of other universities to learn what actually gets a response.",
    },
    publisher: {
      "@type": "Organization",
      name: "Research Match",
      url: SITE,
    },
    datePublished: post.datePublished,
    dateModified: post.datePublished,
    url: `${SITE}/blog/${post.slug}`,
    mainEntityOfPage: `${SITE}/blog/${post.slug}`,
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
      { "@type": "ListItem", position: 3, name: post.title },
    ],
  };

  return (
    <div className="blog-shell blog-post-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <div className="blog-post-container">
        {/* Nav */}
        <nav className="blog-nav">
          <Link href="/" className="blog-brand">
            Research Match
          </Link>
          <div className="blog-nav-links">
            <Link href="/blog" className="blog-nav-link">Blog</Link>
            <Link href="/app" className="blog-green-button blog-nav-button">
              Open Tool
            </Link>
          </div>
        </nav>

        {/* Article */}
        <article className="blog-article">
          <div className="blog-article-hero">
            <p className="blog-kicker">Research Match Guide</p>
            <h1 className="blog-title">
            {post.title}
            </h1>
            <p className="blog-description">{post.description}</p>
          </div>

          {/* Author + date */}
          <div className="blog-author-card">
            <div className="blog-author-avatar">
              <span>J</span>
            </div>
            <div>
              <p className="blog-author-name">Jace</p>
              <p className="blog-author-meta">
                15-year-old founder of Research Match. Cold emailed professors at Princeton, ASU, and dozens of others to learn what actually gets a response.
                {post.datePublished && (
                  <> &middot; {formatBlogDate(post.datePublished)}</>
                )}
              </p>
            </div>
          </div>

          <div
            className="blog-content"
            dangerouslySetInnerHTML={{ __html: articleContent(post) }}
          />
        </article>

        <section className="blog-conversion-panel">
          <div>
            <p className="blog-conversion-kicker">{cta.kicker}</p>
            <h2>{cta.title}</h2>
            <p>{cta.body}</p>
          </div>
          <div className="blog-conversion-actions">
            <Link href={`/app?source=blog&post=${post.slug}`} className="blog-green-button blog-conversion-button">
              {cta.button}
            </Link>
            <span>Free preview.</span>
          </div>
        </section>

        {/* Field guides — routes readers (and crawlers) from the guide cluster
            into the /research field pages. */}
        {relatedFields.length > 0 && (
          <div className="blog-related">
            <h2>Find professors by field</h2>
            <div className="blog-related-list">
              {relatedFields.map((f) => (
                <Link
                  key={f.slug}
                  href={`/research/${f.slug}`}
                  className="blog-related-card"
                >
                  <h3>{f.name} research positions</h3>
                  <p>
                    See {f.name} professors who are publishing right now, what each one
                    works on, and how to email them.
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Related posts */}
        {relatedPosts.length > 0 && (
          <div className="blog-related">
            <h2>
              Related posts
            </h2>
            <div className="blog-related-list">
              {relatedPosts.map((rp) => rp && (
                <Link
                  key={rp.slug}
                  href={`/blog/${rp.slug}`}
                  className="blog-related-card"
                >
                  <h3>
                    {rp.title}
                  </h3>
                  <p>
                    {rp.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="blog-footer">
          <Link href="/blog">
            ← Back to all posts
          </Link>
        </div>
      </div>
    </div>
  );
}
