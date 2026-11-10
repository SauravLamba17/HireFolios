import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname, // don't let a lockfile in a parent folder become the root
  poweredByHeader: false,
};

export default nextConfig;
