import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // There's an unrelated lockfile further up the filesystem; without this Next
  // infers the wrong workspace root and traces far more files than it needs to.
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        // The service worker must be served from the root scope so it can
        // receive push events for the whole origin. Never cache it, or a stale
        // worker will keep handling pushes after a deploy.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
