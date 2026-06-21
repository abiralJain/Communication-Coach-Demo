import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this folder (a stray lockfile in $HOME otherwise
  // confuses Next's auto-detection).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
