import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server-access";

export const dynamic = "force-dynamic";

const CACHE_MS = 5 * 60 * 1000;
let cached: { searches: number; expiresAt: number } | null = null;

function response(searches: number, cacheStatus: "fresh" | "stale") {
  return NextResponse.json(
    { searches },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Stats-Cache": cacheStatus,
      },
    }
  );
}

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) return response(cached.searches, "fresh");

  try {
    const { count, error } = await supabaseAdmin
      .from("search_logs")
      .select("*", { count: "exact", head: true });
    if (error || count === null) throw error ?? new Error("Search count is unavailable");

    cached = { searches: count, expiresAt: Date.now() + CACHE_MS };
    return response(count, "fresh");
  } catch {
    if (cached) return response(cached.searches, "stale");
    return NextResponse.json(
      { error: "stats_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
