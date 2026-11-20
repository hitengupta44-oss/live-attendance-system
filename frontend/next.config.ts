import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is the project root (a stray package-lock.json higher up must not be picked).
  outputFileTracingRoot: path.join(__dirname),
  poweredByHeader: false,
};

export default nextConfig;
