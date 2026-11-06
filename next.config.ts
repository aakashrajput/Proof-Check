import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything here is per-request dynamic data; keep caching off for simplicity.
  cacheComponents: false,
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
