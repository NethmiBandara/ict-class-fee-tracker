import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ict/core"],
  serverExternalPackages: ["@libsql/client", "node:sqlite", "postgres"],
};

export default nextConfig;
