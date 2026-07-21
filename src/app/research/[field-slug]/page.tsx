import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getResearchField, fieldHeadline } from "@/lib/research-fields";
import {
  getFieldContent,
  getFieldProfessors,
  getPopulatedFieldSlugs,
  type FieldProfessor,
} from "@/lib/research-data";
import { siteOrigin } from "@/lib/site-url";
import { serializeJsonLd } from "@/lib/json-ld";

// Fully static: pages are pre-rendered at build from precomputed Supabase rows.
// No data fetching happens on a user request.
export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

const SITE = siteOrigin();

type Props = { params: Promise<{ "field-slug": string }> };

export async function generateStaticParams() {
  const slugs = await getPopulatedFieldSlugs();
  return slugs.map((slug) => ({ "field-slug": slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { "field-slug": slug } = await params;
  const content = await getFieldContent(slug);
  const field = getResearchField(slug);
  if (!content || !field) return {};
  const title = content.meta_title || fieldHeadline(field.name);
  const description =
    content.meta_description ||
    `Find ${field.name} professors who are actively publishing, understand their recent work, and email them with a specific note that gets read.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE}/research/${slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${SITE}/research/${slug}`,
      siteName: "Research Match",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function openAlexUrl(p: FieldProfessor) {
  return p.openalex_author_id ? `https://openalex.org/${p.openalex_author_id}` : null;
}

export default async function ResearchFieldPage({ params }: Props) {
  const { "field-slug": slug } = await params;
  const field = getResearchField(slug);
  if (!field) notFound();

  const [content, professors, populated] = await Promise.all([
    getFieldContent(slug),
    getFieldProfessors(slug),
    getPopulatedFieldSlugs(),
  ]);
  if (!content || professors.length === 0) notFound();

  const heading = fieldHeadline(field.name);
  const remote = content.remote_friendly;
  const remoteLine =
    remote === "remote-friendly"
      ? `Much of the work is computational, so you can offer to contribute remotely.`
      : remote === "hands-on"
        ? `Most of the work happens in person, so being on campus and reliable in the lab matters.`
        : `The work mixes in-person and computational tasks, so there is a way to help either on-site or remotely.`;

  // 3-4 in-body internal links to related, populated field pages.
  const relatedFields = field.related
    .map((s) => getResearchField(s))
    .filter((f): f is NonNullable<typeof f> => !!f && populated.includes(f.slug))
    .slice(0, 4);

  const faq = content.faq ?? [];
  const searchHref = `/app?q=${encodeURIComponent(field.name)}`;
  const toolHref = `/app?source=research&field=${slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: heading,
    description: content.meta_description || `How to find and email ${field.name} professors for a research position.`,
    author: {
      "@type": "Organization",
      name: "Research Match",
      url: SITE,
    },
    publisher: {
      "@type": "Organization",
      name: "Research Match",
      url: SITE,
    },
    url: `${SITE}/research/${slug}`,
    mainEntityOfPage: `${SITE}/research/${slug}`,
    about: `${field.name} research`,
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Research Fields", item: `${SITE}/research` },
      { "@type": "ListItem", position: 3, name: field.name },
    ],
  };

  return (
    <div className="blog-shell blog-post-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      <div className="blog-post-container">
        {/* Nav */}
        <nav className="blog-nav">
          <Link href="/" className="blog-brand">Research Match</Link>
          <div className="blog-nav-links">
            <Link href="/research" className="blog-nav-link">Fields</Link>
            <Link href="/app" className="blog-green-button blog-nav-button">Open Tool</Link>
          </div>
        </nav>

        <article className="blog-article">
          <div className="blog-article-hero">
            <p className="blog-kicker">Research Field Guide</p>
            <h1 className="blog-title">{heading}</h1>
            {/* Inverted pyramid: direct answer first, then detail. */}
            <p className="blog-description">
              To get a {field.name} research position, find professors who are actively
              publishing in {field.name}, read what they actually work on, and email one
              of them a short, specific note. {remoteLine}
            </p>
          </div>

          <div className="blog-content">
            <p>
              Below are {professors.length} professors publishing in {field.name} right now,
              what each is working on, and how to reach out. Every name and topic is pulled
              from real, recent publication data, not a generic list.
            </p>

            {/* DIFFERENTIATOR 1 — real professor table */}
            <h2>{field.name} professors who are actively publishing</h2>
            <table className="rm-research-table">
              <thead>
                <tr>
                  <th>Professor</th>
                  <th>Institution</th>
                  <th>Recent research focus</th>
                </tr>
              </thead>
              <tbody>
                {professors.map((p, i) => {
                  const url = openAlexUrl(p);
                  return (
                    <tr key={`${p.openalex_author_id ?? p.professor_name}-${i}`}>
                      <td>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">{p.professor_name}</a>
                        ) : (
                          p.professor_name
                        )}
                      </td>
                      <td>{p.institution ?? "-"}</td>
                      <td>{p.recent_topic ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="rm-research-tablenote">
              Sourced from OpenAlex publication records. Click a name to see their full
              profile and recent papers.
            </p>

            {/* DIFFERENTIATOR 3 — field-specific research overview */}
            {content.research_overview && (
              <>
                <h2>What {field.name} research involves</h2>
                <p>{content.research_overview}</p>
              </>
            )}

            {/* DIFFERENTIATOR 2 — field-specific email advice */}
            {content.email_angle && (
              <>
                <h2>How to email a {field.name} professor</h2>
                <p>{content.email_angle}</p>
              </>
            )}

            {/* In-body internal links */}
            {relatedFields.length > 0 && (
              <p>
                {field.name} overlaps with nearby fields. If you are casting a wider net,
                look at research positions in{" "}
                {relatedFields.map((rf, i) => (
                  <span key={rf.slug}>
                    <Link href={`/research/${rf.slug}`}>{rf.name}</Link>
                    {i < relatedFields.length - 2 ? ", " : i === relatedFields.length - 2 ? ", and " : "."}
                  </span>
                ))}
              </p>
            )}
          </div>
        </article>

        {/* CTA into the tool */}
        <section className="blog-conversion-panel">
          <div>
            <p className="blog-conversion-kicker">Reach out with confidence</p>
            <h2>Find more {field.name} professors and check your email.</h2>
            <p>
              Search by interest to surface more {field.name} labs, read plain-English
              summaries of their work, and run your draft through the email checker before
              you hit send.
            </p>
          </div>
          <div className="blog-conversion-actions">
            <Link href={searchHref} className="blog-green-button blog-conversion-button">
              Find {field.name} professors
            </Link>
            <Link href={toolHref} className="blog-nav-link rm-research-secondary-cta">
              Check your email before you send
            </Link>
          </div>
        </section>

        {/* FAQ — visible content, no FAQPage schema (Google restricts FAQ rich results) */}
        {faq.length > 0 && (
          <div className="rm-research-faq">
            <h2>Questions students ask about {field.name} research</h2>
            {faq.map((item, i) => (
              <div key={i} className="rm-research-faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="blog-footer">
          <Link href="/research">← All research fields</Link>
        </div>
      </div>
    </div>
  );
}
