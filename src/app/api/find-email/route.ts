import { NextRequest, NextResponse } from "next/server";
import { foldName } from "@/lib/author-normalize";
import { isOaAuthorId } from "@/lib/openalex";
import { allowRequestRate, requestAccess } from "@/lib/server-access";
import { safeFetchText } from "@/lib/safe-fetch";

// Does an email's local part plausibly belong to this person (not a colleague listed
// on the same faculty/team page)? Diacritic-aware via foldName (Böckler→boeckler).
function emailMatchesName(email: string, name: string): boolean {
  // foldName turns separators (. _ -) into spaces, so this gives real local-part
  // segments. We match on whole segments, never substrings, so a colleague's address
  // (e.g. "jgoldsmith" for "John Smith") can't pass.
  const segs = foldName(email.split("@")[0]).split(" ").filter(Boolean);
  const toks = foldName(name).split(" ").filter(Boolean);
  if (segs.length === 0 || toks.length === 0) return false;
  const first = toks[0];
  const last = toks[toks.length - 1];
  if (!last) return false;
  const fi = first ? first[0] : "";

  if (segs.length === 1) {
    // Concatenated local part (no separators): require EXACT equality to a known
    // pattern — surname only, first+last, last+first, or initial+last (jsmith).
    const s = segs[0];
    return (
      s === last ||
      s === first + last ||
      s === last + first ||
      (!!fi && (s === fi + last || s === last + fi))
    );
  }
  // Separated local part: surname must be a whole segment, plus the first name or its
  // initial as another segment.
  if (!segs.includes(last)) return false;
  return segs.includes(first) || segs.some((x) => x.length === 1 && x === fi);
}

// Email finder. Order of trust:
//   1. ORCID public email (verified)
//   2. Corresponding-author email embedded in their papers (verified)
//   3. Their real faculty/directory page — found via web search, then scraped for an
//      address on the institution's domain (likely). This is the step that mirrors
//      what a human does: "search them up, read the email off their school page."
//   4. Pattern guess (first.last@domain) as a last resort (guess)
//
// The institution domain is resolved from OpenAlex's record of the institution
// (homepage_url), so it's correct for any university, not just a hardcoded list.

interface EmailResult {
  email: string;
  source: string;
  confidence: "verified" | "likely" | "guess";
}

const PUBLIC_SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.researchmatch.site";
const OPENALEX_MAILTO = process.env.NEXT_PUBLIC_OPENALEX_MAILTO || "contact@researchmatch.site";
const UA = `Mozilla/5.0 (compatible; ResearchMatch/1.0; +${PUBLIC_SITE}) academic-contact-lookup`;

// Multi-label academic TLDs where the registrable domain is the last 3 labels.
const THREE_LABEL_TLDS = [
  "ac.uk", "ac.nz", "ac.jp", "ac.kr", "ac.in", "ac.za", "ac.il", "ac.at", "ac.be",
  "edu.au", "edu.sg", "edu.cn", "edu.hk", "edu.my", "edu.in", "co.uk", "org.uk",
];

function coreDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (THREE_LABEL_TLDS.includes(lastTwo)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

function domainFromUrl(url: string): string | null {
  try {
    return coreDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

// Pull emails out of raw HTML/text, de-obfuscating the common "name [at] dept [dot] edu"
// dodges, and dropping boilerplate addresses.
function extractEmails(raw: string): string[] {
  // Bound the work first: drop script/style blocks and cap the size, so a huge or
  // hostile page (URLs come from web search) can't cause pathological regex
  // backtracking (ReDoS) and burn the serverless worker's CPU.
  const capped = raw.slice(0, 200_000).replace(/<(script|style)[\s\S]{0,200000}?<\/\1>/gi, " ");
  const text = capped
    .replace(/\s*(?:\[|\(|\{|&#91;|&#40;)\s*at\s*(?:\]|\)|\}|&#93;|&#41;)\s*/gi, "@")
    .replace(/\s+at\s+(?=[a-z0-9.-]+\.[a-z]{2,})/gi, "@")
    .replace(/\s*(?:\[|\(|\{)\s*dot\s*(?:\]|\)|\})\s*/gi, ".")
    .replace(/\s+dot\s+(?=[a-z]{2,})/gi, ".")
    .replace(/&#64;|&commat;/gi, "@");
  // Bounded quantifiers (no unbounded +) keep this linear-time.
  const matches = text.match(/[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}(?:\.[A-Z]{2,24})?/gi) || [];
  const bad = /(example|noreply|no-reply|donotreply|webmaster|postmaster|info@|admin@|support@|press@|media@|sentry|wixpress|\.png$|\.jpg$|\.gif$|\.webp$)/i;
  return [...new Set(matches.map((m) => m.toLowerCase()))].filter((e) => !bad.test(e));
}

// Web search → result URLs. Uses Serper (google.serper.dev) when SERPER_API_KEY is
// set (reliable); otherwise falls back to scraping DuckDuckGo's HTML endpoint
// (best-effort — datacenter IPs are sometimes rate-limited).
async function searchWeb(query: string, limit = 5): Promise<string[]> {
  const key = process.env.SERPER_API_KEY;
  try {
    if (key) {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: limit }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.organic ?? []).map((o: { link?: string }) => o.link).filter(Boolean).slice(0, limit);
      }
    }
  } catch { /* fall through to DDG */ }

  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls: string[] = [];
    const re = /class="result__a"[^>]*href="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && urls.length < limit) {
      let href = m[1];
      // DDG wraps results as /l/?uddg=<encoded-real-url>
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]);
      if (href.startsWith("http")) urls.push(href);
    }
    return urls;
  } catch {
    return [];
  }
}

async function fetchPageEmails(url: string): Promise<string[]> {
  try {
    return extractEmails(await safeFetchText(url, { "User-Agent": UA }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    // Each call burns paid Serper credits plus several outbound fetches.
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "Sign in to find professor emails." }, { status: 401 });
    }
    if (!access.isPaid) {
      return NextResponse.json({ error: "upgrade_required" }, { status: 403 });
    }
    if (!(await allowRequestRate(req, "find-email", 6, access.user.id))) {
      return NextResponse.json({ error: "Too many lookups. Try again in a minute." }, { status: 429 });
    }

    const { authorId, authorName, institution } = await req.json();
    // authorId gets interpolated into OpenAlex URL paths and filters below —
    // validate the format, don't just check presence.
    if (!isOaAuthorId(authorId)) {
      return NextResponse.json({ error: "authorId required" }, { status: 400 });
    }
    if (
      typeof authorName !== "string" || !authorName.trim() || authorName.length > 200 ||
      typeof institution !== "string" || institution.length > 300
    ) {
      return NextResponse.json({ error: "Professor details are malformed." }, { status: 400 });
    }

    const emails: EmailResult[] = [];
    const seen = new Set<string>();
    const add = (e: EmailResult) => {
      if (!seen.has(e.email)) { seen.add(e.email); emails.push(e); }
    };

    let orcidId: string | null = null;
    let homepageUrl: string | null = null;
    let instId: string | null = null;
    let instDomain: string | null = null;

    // 1. Author record from OpenAlex → ORCID + institution id.
    try {
      const authorRes = await fetch(
        `https://api.openalex.org/authors/${authorId}?select=orcid,ids,last_known_institutions,display_name&mailto=${encodeURIComponent(OPENALEX_MAILTO)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (authorRes.ok) {
        const a = await authorRes.json();
        if (a.orcid) orcidId = a.orcid.replace("https://orcid.org/", "");
        instId = a.last_known_institutions?.[0]?.id?.split("/").pop() ?? null;
      }
    } catch { /* continue */ }

    // 2. Resolve the institution's real domain from OpenAlex (works for any uni).
    if (instId) {
      try {
        const instRes = await fetch(
          `https://api.openalex.org/institutions/${instId}?select=homepage_url,display_name&mailto=${encodeURIComponent(OPENALEX_MAILTO)}`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (instRes.ok) {
          const inst = await instRes.json();
          if (inst.homepage_url) instDomain = domainFromUrl(inst.homepage_url);
        }
      } catch { /* continue */ }
    }
    if (!instDomain && institution) instDomain = guessDomain(institution);

    // 3. ORCID public email + faculty URL.
    if (orcidId) {
      try {
        const r = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/email`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const d = await r.json();
          for (const e of d.email || []) {
            if (e.email) add({ email: e.email.toLowerCase(), source: "orcid", confidence: "verified" });
          }
        }
      } catch { /* continue */ }
      try {
        const r = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/researcher-urls`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const d = await r.json();
          for (const u of d["researcher-url"] || []) {
            const url = u.url?.value;
            if (url && isAcademicProfileUrl(url)) { homepageUrl = url; break; }
          }
        }
      } catch { /* continue */ }
    }

    // 4. Corresponding-author email embedded in recent papers.
    try {
      const r = await fetch(
        `https://api.openalex.org/works?filter=author.id:${authorId}&sort=publication_year:desc&per_page=10&select=corresponding_author_ids,authorships&mailto=${encodeURIComponent(OPENALEX_MAILTO)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        const d = await r.json();
        for (const work of d.results ?? []) {
          const isCorr = work.corresponding_author_ids?.some((id: string) => id === `https://openalex.org/${authorId}`);
          if (!isCorr) continue;
          for (const au of work.authorships ?? []) {
            if (au.author?.id === `https://openalex.org/${authorId}` && au.raw_author_name) {
              const match = au.raw_author_name.match(/[\w.-]+@[\w.-]+\.\w+/);
              if (match) add({ email: match[0].toLowerCase(), source: "openalex", confidence: "verified" });
            }
          }
        }
      }
    } catch { /* continue */ }

    // Trusted institution domains — their real school address lives on one of these.
    const paramDomain = institution ? guessDomain(institution) : null;
    const trusted = new Set<string>();
    if (instDomain) trusted.add(instDomain);
    if (paramDomain) trusted.add(paramDomain);

    // 5. The human step: find their faculty/directory page and read the email off it.
    // Only when we don't already have a verified address (the common case — few
    // researchers expose an email via ORCID).
    const candidatePages: string[] = [];
    if (homepageUrl) candidatePages.push(homepageUrl);
    if (emails.length === 0 && authorName) {
      const hits = await searchWeb(`${authorName} ${institution || ""} email`.trim(), 5);
      const ranked = hits.sort(
        (a, b) => pageScore(b, instDomain, paramDomain) - pageScore(a, instDomain, paramDomain)
      );
      candidatePages.push(...ranked.slice(0, 3));
    }

    let facultyPageDomain: string | null = null;
    if (emails.length === 0 && candidatePages.length > 0) {
      const pages = [...new Set(candidatePages)].slice(0, 3);
      const results = await Promise.all(pages.map(async (url) => ({ url, found: await fetchPageEmails(url) })));
      for (const { url, found } of results) {
        const pageDomain = domainFromUrl(url);
        const pageAcademic =
          !!pageDomain && (/(\.edu$|\.ac\.|\.edu\.)/.test(pageDomain) || trusted.has(pageDomain));
        if (pageAcademic && !facultyPageDomain) facultyPageDomain = pageDomain;
        for (const email of found) {
          const emDomain = coreDomain(email.split("@")[1] || "");
          const domainOk = trusted.has(emDomain) || (pageAcademic && emDomain === pageDomain);
          // Require the local part to match THIS person — team/directory pages list many
          // people, and emailing the wrong professor is worse than no email.
          if (domainOk && emailMatchesName(email, authorName || "")) {
            add({ email, source: "faculty page", confidence: "likely" });
          }
        }
      }
      if (!homepageUrl && pages[0]) homepageUrl = pages[0];
    }

    // 6. Search links for the user (manual fallback).
    const dirDomain = facultyPageDomain || instDomain || paramDomain;
    const searchUrls = {
      google: `https://www.google.com/search?q=${encodeURIComponent(`"${authorName}" email ${institution || ""}`)}`,
      scholar: `https://scholar.google.com/scholar?q=${encodeURIComponent(`author:"${authorName}"`)}`,
      directory: dirDomain
        ? `https://www.google.com/search?q=${encodeURIComponent(`"${authorName}" contact site:${dirDomain}`)}`
        : null,
    };

    // 7. Pattern guesses — last resort. Prefer the domain of the faculty page we
    // actually found, then the searched institution, then OpenAlex's primary.
    const guessDom = facultyPageDomain || paramDomain || instDomain;
    const nameParts = (authorName || "").trim().split(/\s+/);
    if (emails.length === 0 && nameParts.length >= 2 && guessDom) {
      const first = nameParts[0].toLowerCase().replace(/[^a-z]/g, "");
      const last = nameParts[nameParts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
      if (first && last) {
        const fi = first[0];
        for (const p of [`${first}.${last}@${guessDom}`, `${fi}${last}@${guessDom}`, `${last}@${guessDom}`]) {
          add({ email: p, source: "pattern", confidence: "guess" });
        }
      }
    }

    return NextResponse.json({
      emails: emails.slice(0, 5),
      searchUrls,
      homepageUrl,
      orcidUrl: orcidId ? `https://orcid.org/${orcidId}` : null,
    });
  } catch (err) {
    console.error("find-email error:", err);
    // Return the contract shape (not a raw error) so the client renderer never crashes.
    return NextResponse.json({ emails: [], searchUrls: { google: "", scholar: "", directory: null }, homepageUrl: null, orcidUrl: null });
  }
}

// Rank a search-result URL by how likely it is to be the person's official page.
function pageScore(url: string, instDomain: string | null, paramDomain?: string | null): number {
  let s = 0;
  const u = url.toLowerCase();
  if (instDomain && u.includes(instDomain)) s += 5;
  if (paramDomain && u.includes(paramDomain)) s += 5;
  if (/(faculty|people|staff|profile|directory|\/team\/|\/~)/.test(u)) s += 2;
  if (/(\.edu|ac\.)/.test(u)) s += 1;
  if (/(linkedin|researchgate|twitter|facebook|wikipedia|amazon)/.test(u)) s -= 3;
  return s;
}

// Fallback domain map for when OpenAlex has no homepage_url for the institution.
function guessDomain(institution: string): string | null {
  const domainMap: Record<string, string> = {
    "massachusetts institute of technology": "mit.edu",
    "stanford university": "stanford.edu",
    "harvard university": "harvard.edu",
    "university of oxford": "ox.ac.uk",
    "university of cambridge": "cam.ac.uk",
    "california institute of technology": "caltech.edu",
    "yale university": "yale.edu",
    "princeton university": "princeton.edu",
    "columbia university": "columbia.edu",
    "university of california, berkeley": "berkeley.edu",
    "cornell university": "cornell.edu",
    "university of chicago": "uchicago.edu",
    "imperial college london": "imperial.ac.uk",
    "university college london": "ucl.ac.uk",
    "eth zurich": "ethz.ch",
    "university of toronto": "utoronto.ca",
  };
  const instLower = institution.toLowerCase();
  return domainMap[instLower] ?? null;
}

function isAcademicProfileUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host.endsWith(".edu") ||
      host.includes(".ac.") ||
      host.includes(".edu.") ||
      /(faculty|staff|people|profile|directory)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
