import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname, // don't let a lockfile in a parent folder become the root
  poweredByHeader: false,
  // NEXT_DIST_DIR lets a production build run while `next dev` is using .next (both write there).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
