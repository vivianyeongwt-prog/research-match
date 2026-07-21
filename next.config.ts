import type { NextConfig } from "next";

function validOrigin(value: string | undefined, fallback: string) {
  try {
    return new URL(value || fallback).origin;
  } catch {
    return fallback;
  }
}

const canonicalOrigin = validOrigin(process.env.NEXT_PUBLIC_SITE_URL, "https://www.researchmatch.site");
const posthogOrigin = validOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST, "https://us.i.posthog.com");
const canonicalHost = new URL(canonicalOrigin).hostname;
const redirectHosts = (process.env.CANONICAL_REDIRECT_HOSTS ?? "researchmatch.site,research-match-three.vercel.app")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter((host) => host && host !== canonicalHost);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return redirectHosts.map((host) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value: host }],
        destination: `${canonicalOrigin}/:path*`,
        permanent: true,
    }));
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openalex.org https://*.openalex.org ${posthogOrigin} https://us-assets.i.posthog.com https://*.vercel-insights.com; upgrade-insecure-requests` },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  experimental: {
    optimizeCss: true,
  },
};

export default nextConfig;
