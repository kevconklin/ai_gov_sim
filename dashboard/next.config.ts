import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pg"],
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
