const {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} = require("next/constants");

/** @type {(phase: string, defaultConfig: import("next").NextConfig) => Promise<import("next").NextConfig>} */
module.exports = async (phase) => {
  /** @type {import("next").NextConfig} */
  const nextConfig = {
    productionBrowserSourceMaps: true,
    webpack: (config, { isServer }) => {
      // Fix for web-tree-sitter in browser environment
      if (!isServer) {
        config.resolve.fallback = {
          ...config.resolve.fallback,
          fs: false,
          'fs/promises': false,
          module: false,
          path: false,
        };
      }
      return config;
    },
    images: {
      domains: [
        'linkedinorleftoutwebsite.s3.us-west-2.amazonaws.com',
        'd158alpjmt7vrd.cloudfront.net',
        'lh3.googleusercontent.com',
      ],
    },
    async redirects() {
      return [
        {
          source: '/unsupported',
          destination: '/waitlist',
          permanent: true,
        },
      ];
    },
    async headers() {
      return [
        {
          // Apply COEP/COOP headers for pages that use Pyodide
          source: '/debug/:path*',
          headers: [
            { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ],
        },
        {
          // Apply COEP/COOP headers for problems pages that use Pyodide
          source: '/problems/:path*',
          headers: [
            { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ],
        },
        {
          // Apply COEP/COOP headers for projects pages that use Pyodide
          source: '/projects/:path*',
          headers: [
            { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          ],
        },
        {
          source: '/pyodide/:path*',
          headers: [
            { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
            { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          ],
        },
        {
          // Tree-sitter WASM files for syntax parsing
          source: '/tree-sitter/:path*',
          headers: [
            { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
            { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          ],
        },
      ];
    },
  };

  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    // Using `git rev-parse HEAD` might not the most efficient
    // way of determining a revision. You may prefer to use
    // the hashes of every extra file you precache.
    const { spawnSync } = require("node:child_process");
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ?? crypto.randomUUID();

    const withSerwist = (await import("@serwist/next")).default({
      additionalPrecacheEntries: [
        { url: "/~offline", revision },
        { url: "/", revision },
        { url: "/projects", revision },
        { url: "/projects/1", revision },
        // Explicitly precache projects 0-6 for offline availability
        { url: "/projects/0", revision },
        { url: "/projects/2", revision },
        { url: "/projects/3", revision },
        { url: "/projects/4", revision },
        { url: "/projects/5", revision },
        { url: "/projects/6", revision },
        { url: "/study-plan", revision },

        // Pyodide assets for offline Python execution (~13MB total)
        // These are precached for instant offline performance on desktop.
        // Mobile devices delete this cache immediately after install (see sw.ts).
        { url: "/pyodide/0.28.2/packages.json", revision },
        { url: "/pyodide/0.28.2/pyodide.asm.wasm", revision },
        { url: "/pyodide/0.28.2/pyodide.js", revision },
        { url: "/pyodide/0.28.2/python_stdlib.zip", revision },
        { url: "/pyodide/0.28.2/repodata.json", revision },
      ],
      swSrc: "src/app/sw.ts",
      swDest: "public/sw.js",
      // Inject environment variables into service worker
      injectionPoint: "self.__SW_MANIFEST",
    });
    return withSerwist(nextConfig);
  }

  return nextConfig;
};