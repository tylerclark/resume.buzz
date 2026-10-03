import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF renderer reads its fonts from disk at runtime (see lib/pdf.tsx).
  outputFileTracingIncludes: { "/api/pdf": ["./src/assets/fonts/*"] },
};

export default nextConfig;
