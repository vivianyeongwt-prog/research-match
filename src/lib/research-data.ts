// Read helpers for the programmatic /research pages. These run at BUILD time
// (generateStaticParams + static page render), never on a user request — the
// pages are fully static. Reads go through the shared anon Supabase client; the
// field_professors / field_content tables expose a public-read RLS policy.
import { supabase } from "@/lib/supabase";

export interface FieldProfessor {
  professor_name: string;
  institution: string | null;
  recent_topic: string | null;
  openalex_author_id: string | null;
  last_publication_year: number | null;
}

export interface FieldFaqItem {
  question: string;
  answer: string;
}

export interface FieldContent {
  field_slug: string;
  field_name: string;
  meta_title: string | null;
  meta_description: string | null;
  email_angle: string | null;
  research_overview: string | null;
  remote_friendly: "remote-friendly" | "hands-on" | "mixed" | null;
  faq: FieldFaqItem[] | null;
}

export async function getFieldContent(slug: string): Promise<FieldContent | null> {
  const { data } = await supabase
    .from("field_content")
    .select("*")
    .eq("field_slug", slug)
    .single();
  return (data as FieldContent) ?? null;
}

export async function getFieldProfessors(slug: string): Promise<FieldProfessor[]> {
  const { data } = await supabase
    .from("field_professors")
    .select("professor_name, institution, recent_topic, openalex_author_id, last_publication_year")
    .eq("field_slug", slug)
    .order("last_publication_year", { ascending: false });
  return (data as FieldProfessor[]) ?? [];
}

let populatedFieldSlugs: Promise<string[]> | null = null;

async function fetchPopulatedFieldSlugs(): Promise<string[]> {
  // Both tables, because the page below renders only when it has content AND at
  // least one professor. Seeding from field_content alone would emit params for a
  // field that then calls notFound(), shipping a 404 that the sitemap advertises
  // and other pages link to. seo-fetch-professors.mjs deletes a field's professor
  // rows before re-inserting, so "content but no professors" is a state a failed
  // or partial fetch run genuinely leaves behind.
  const [content, professors] = await Promise.all([
    supabase.from("field_content").select("field_slug"),
    supabase.from("field_professors").select("field_slug"),
  ]);
  const hasProfessors = new Set(
    (professors.data ?? []).map((r: { field_slug: string }) => r.field_slug)
  );
  return (content.data ?? [])
    .map((r: { field_slug: string }) => r.field_slug)
    .filter((slug) => hasProfessors.has(slug))
    .sort();
}

/**
 * Field slugs whose page actually builds — the single source of truth for
 * generateStaticParams, the sitemap, and every internal link that points at a
 * field page. Anything derived from this set can never point at a 404.
 *
 * Sorted so the order is stable across builds regardless of row order.
 *
 * Memoized because every statically rendered research page, every blog post, the
 * sitemap, and generateStaticParams ask for the same unchanging row set; without
 * this a build fires ~40 identical queries. The memo lives for the process
 * lifetime, which is a build in production (every consumer prerenders). Under
 * `next dev` that means a field_content row added while the dev server is running
 * needs a restart to show up.
 */
export function getPopulatedFieldSlugs(): Promise<string[]> {
  populatedFieldSlugs ??= fetchPopulatedFieldSlugs();
  return populatedFieldSlugs;
}

/** Index-page rows: every field that has content. */
export async function getAllFieldContent(): Promise<FieldContent[]> {
  const { data } = await supabase
    .from("field_content")
    .select("*")
    .order("field_name", { ascending: true });
  return (data as FieldContent[]) ?? [];
}
