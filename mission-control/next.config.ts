import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://localhost:3850",
    "http://127.0.0.1:3850",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost",
    "http://127.0.0.1",
    "localhost",
    "127.0.0.1",
  ],
  devIndicators: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Fix workspace root detection warning
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
