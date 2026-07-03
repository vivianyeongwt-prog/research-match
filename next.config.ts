import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "research-match-three.vercel.app" }],
        destination: "https://www.researchmatch.site/:path*",
        permanent: true,
      },
      // Apex → www, permanent (308). Normally Vercel's domain-level redirect fires
      // first and this never runs — it's the safety net so the canonical host holds
      // even if the dashboard redirect is removed. The dashboard redirect must be
      // set to 308 (permanent), NOT 307: a temporary redirect makes Google keep the
      // apex URLs indexed forever ("Page with redirect" / "Redirect error" in GSC).
      {
        source: "/:path*",
        has: [{ type: "host", value: "researchmatch.site" }],
        destination: "https://www.researchmatch.site/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  experimental: {
    optimizeCss: true,
  },
};

export default nextConfig;
