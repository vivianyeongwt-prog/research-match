import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { oaUrl } from "@/lib/openalex";
import { allowRequestRate, requestAccess } from "@/lib/server-access";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

interface NearbyAuthor {
  id?: string;
  works_count?: number;
  cited_by_count?: number;
}

export async function POST(req: NextRequest) {
  try {
    const access = await requestAccess(req);
    if (!access.user) {
      return NextResponse.json({ error: "Sign in to view nearby researchers." }, { status: 401 });
    }
    if (!access.isPaid) {
      return NextResponse.json({ error: "upgrade_required" }, { status: 403 });
    }
    if (!(await allowRequestRate(req, "nearby-authors", 4, access.user.id))) {
      return NextResponse.json({ error: "Too many nearby searches. Try again in a minute." }, { status: 429 });
    }

    const { institutionName, topicId, excludeIds }: {
      institutionName: string;
      topicId: string;
      excludeIds: string[];
    } = await req.json();
    if (
      typeof institutionName !== "string" || !institutionName.trim() || institutionName.length > 300 ||
      typeof topicId !== "string" || !/^T\d+$/i.test(topicId) ||
      !Array.isArray(excludeIds) || excludeIds.length > 100 || excludeIds.some((id) => typeof id !== "string" || id.length > 80)
    ) {
      return NextResponse.json({ error: "Nearby search input is malformed." }, { status: 400 });
    }

    // Step 1: Ask AI for geographically nearby universities
    const chat = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You return a JSON array of university names; nothing else. No explanation, no markdown, no extra text.",
        },
        {
          role: "user",
          content: `List 8 universities geographically closest to "${institutionName}". Do not include "${institutionName}" itself. Return only a JSON array of university names, e.g. ["Harvard University", "Boston University"]`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    const raw = chat.choices[0]?.message?.content?.trim() ?? "[]";
    let nearbyNames: string[] = [];
    try {
      nearbyNames = JSON.parse(raw);
    } catch {
      // Try to extract JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) nearbyNames = JSON.parse(match[0]);
    }

    nearbyNames = Array.isArray(nearbyNames)
      ? nearbyNames.filter((name): name is string => typeof name === "string" && !!name.trim() && name.length <= 200)
      : [];

    if (!nearbyNames.length) {
      return NextResponse.json({ authors: [] });
    }

    // Step 2: Resolve each nearby university name to an OpenAlex institution ID
    const resolvedInstIds: string[] = [];
    await Promise.all(
      nearbyNames.slice(0, 8).map(async (name) => {
        try {
          const r = await fetch(
            oaUrl(`https://api.openalex.org/institutions?search=${encodeURIComponent(name)}&per_page=1`),
            { signal: AbortSignal.timeout(4000) }
          );
          if (!r.ok) return;
          const d = await r.json();
          const inst = d.results?.[0];
          if (inst?.id) {
            const shortId = inst.id.split("/").pop();
            if (shortId) resolvedInstIds.push(shortId);
          }
        } catch { /* skip */ }
      })
    );

    if (!resolvedInstIds.length) {
      return NextResponse.json({ authors: [] });
    }

    // Step 3: For each institution, fetch top author in that topic
    const authorsByInst = await Promise.all(
      resolvedInstIds.map(async (instId) => {
        try {
          const r = await fetch(
            oaUrl(`https://api.openalex.org/authors?filter=topics.id:${encodeURIComponent(topicId)},last_known_institutions.id:${instId}&per_page=3&sort=cited_by_count:desc`),
            { signal: AbortSignal.timeout(5000) }
          );
          if (!r.ok) return [];
          const d = await r.json();
          return (d.results ?? []) as NearbyAuthor[];
        } catch { return []; }
      })
    );

    // Flatten, deduplicate, filter out excluded IDs and low work counts
    const seen = new Set<string>(excludeIds);
    const candidates: NearbyAuthor[] = [];
    for (const group of authorsByInst) {
      for (const author of group) {
        const authorId = author.id;
        const shortId = authorId?.split("/").pop();
        if (!authorId || !shortId || seen.has(authorId) || seen.has(shortId)) continue;
        if ((author.works_count ?? 0) < 15) continue;
        seen.add(authorId);
        seen.add(shortId);
        candidates.push(author);
      }
    }

    // Sort by citations and return top 3
    candidates.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0));
    return NextResponse.json({ authors: candidates.slice(0, 3) });
  } catch (err) {
    console.error("nearby-authors error:", err);
    return NextResponse.json({ authors: [] });
  }
}
