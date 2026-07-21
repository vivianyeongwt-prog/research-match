import { NextRequest, NextResponse } from "next/server";
import { isOaAuthorId, oaUrl } from "@/lib/openalex";
import { allowRequestRate } from "@/lib/server-access";

interface AuthorInput {
  id: string;
  works_count: number;
  cited_by_count: number;
  has_institution: boolean;
}

interface ScoredAuthor {
  id: string;
  score: number;
}

interface OpenAlexAuthorship {
  author?: { id?: string };
  author_position?: string;
}

interface OpenAlexWork {
  publication_year?: number;
  authorships?: OpenAlexAuthorship[];
}

export async function POST(req: NextRequest) {
  try {
    if (!(await allowRequestRate(req, "score-authors", 10))) {
      return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
    }

    const { authors }: { authors: AuthorInput[] } = await req.json();
    if (
      !Array.isArray(authors) || authors.length > 50 ||
      authors.some((author) =>
        !author || typeof author.id !== "string" || !isOaAuthorId(author.id.split("/").pop()) ||
        !Number.isFinite(author.works_count) || author.works_count < 0 ||
        !Number.isFinite(author.cited_by_count) || author.cited_by_count < 0 ||
        typeof author.has_institution !== "boolean"
      )
    ) {
      return NextResponse.json({ error: "authors must be an array of at most 50" }, { status: 400 });
    }
    const fiveYearsAgo = new Date().getFullYear() - 5;

    const scored: ScoredAuthor[] = await Promise.all(
      authors.map(async (author) => {
        let score = 0;
        const authorId = author.id.split("/").pop();

        // +2 for 15+ total publications
        if (author.works_count >= 15) score += 2;

        // -3 for fewer than 5 papers
        if (author.works_count < 5) score -= 3;

        // +1 for having institutional affiliation
        if (author.has_institution) score += 1;

        // Fetch recent works to check last-author status and publishing span
        try {
          const worksRes = await fetch(
            oaUrl(`https://api.openalex.org/works?filter=author.id:${encodeURIComponent(authorId ?? "")},publication_year:>${fiveYearsAgo}&sort=publication_year:desc&per_page=15&select=authorships,publication_year`),
            { signal: AbortSignal.timeout(5000) }
          );
          if (!worksRes.ok) throw new Error(`OpenAlex ${worksRes.status}`);
          const worksData = await worksRes.json();
          const works = (worksData.results ?? []) as OpenAlexWork[];

          // Count last-author appearances
          let lastAuthorCount = 0;
          const years: number[] = [];

          for (const w of works) {
            if (w.publication_year) years.push(w.publication_year);
            const authorship = w.authorships?.find(
              (a) => a.author?.id === `https://openalex.org/${authorId}`
            );
            if (authorship) {
              if (authorship.author_position === "last") {
                lastAuthorCount++;
              }
            }
          }

          // +3 for last author on 3+ papers (strong signal in biology/medicine)
          if (lastAuthorCount >= 3) score += 3;

          // +1 for any last-author appearances (weaker signal)
          else if (lastAuthorCount >= 1) score += 1;

          // Note: no penalty for first/middle-only — authorship order conventions
          // vary by field (astronomy, physics, math use alphabetical ordering)

          // +2 for publishing span of 5+ years
          if (years.length >= 2) {
            const span = Math.max(...years) - Math.min(...years);
            if (span >= 5) score += 2;
          }
        } catch {
          // If works fetch fails, score based on what we have
        }

        return { id: author.id, score };
      })
    );

    return NextResponse.json({ scored });
  } catch (err) {
    console.error("score-authors error:", err);
    // Return an empty list (not a 500) so the client keeps its candidates and
    // falls back to a light filter, instead of showing zero professors.
    return NextResponse.json({ scored: [] });
  }
}
