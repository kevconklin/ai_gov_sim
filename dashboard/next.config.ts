import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traced server bundle plus only the node_modules it actually reaches. The image drops from
  // roughly a gigabyte to under two hundred megabytes, which matters when every pod pulls it.
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  serverExternalPackages: ["better-sqlite3", "pg"],
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
