import type { NextConfig } from "next";

// Optional sub-path deployment (GitHub Pages project site). When
// NEXT_PUBLIC_BASE_PATH is set (e.g. "/gamemaster-ai" in the Pages CI
// build — see .github/workflows/deploy-pages.yml), the app is served
// under that prefix: `basePath` rewrites routes/links and
// `assetPrefix` rewrites the /_next asset URLs. When it is unset the
// config is exactly the root deployment used for Firebase Hosting.
// The value is read at build time and inlined into client bundles, so
// each target is built separately.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // Firebase Hosting on the Spark plan has no server runtime (SSR would
  // need Cloud Functions / Blaze), so the app ships as a static export.
  // Every page is client-side (Firebase client SDK), which makes this a
  // pure configuration change — see BUILD_SPEC.md §12.
  output: "export",
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // NOTE: cacheComponents / partialPrefetching were removed — Next 16
  // rejects them in export mode ("PPR cannot be enabled in export
  // mode"), and this app uses no Cache Components APIs ('use cache',
  // cacheLife, …): every page is a client component, so nothing changes
  // at runtime.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
