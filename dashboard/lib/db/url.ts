import path from "node:path";
import type { DbTarget } from "./types";

/** Parse DATABASE_URL-style strings into a connection target. */
export function parseDbUrl(raw: string | undefined, cwd: string = process.cwd()): DbTarget {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new Error("Database URL is not set. Set DATABASE_URL (see dashboard/README.md).");
  }
  if (/^postgres(ql)?:\/\//i.test(value)) {
    return { kind: "postgres", url: value };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("file:")) {
    throw new Error("Unsupported database URL scheme. Use a file path, file:, or postgres://.");
  }
  let filePath = value.startsWith("file:") ? value.slice("file:".length) : value;
  if (filePath.startsWith("//")) filePath = filePath.slice(2);
  return { kind: "sqlite", path: path.resolve(cwd, filePath) };
}
