import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone-Build für das Docker-Image (apps/web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
