/**
 * Service Worker for Learn with Leo PWA
 * 
 * Caching Strategy Overview:
 * - Precached: /, /projects, /projects/1, /study-plan, /~offline (at install time)
 * - Static assets (_next/static/*): CacheFirst with expiration
 * - App assets (icons, images): CacheFirst with expiration  
 * - /projects/* navigations & RSC: StaleWhileRevalidate (dedicated caches)
 * - Other page navigations: StaleWhileRevalidate with ~offline fallback
 * - API data: NetworkFirst for user-specific data with strict caching guardrails
 * 
 * Route Priority (first match wins):
 * 1. Static assets (CacheFirst)
 * 2. /projects RSC requests → PROJECTS_RSC_SWR (StaleWhileRevalidate)
 * 3. /projects navigations → PROJECTS_NAV_SWR (StaleWhileRevalidate)
 * 4. Generic RSC requests → GENERIC_RSC_SWR (StaleWhileRevalidate)
 * 5. Generic navigations → GENERIC_NAV_SWR (StaleWhileRevalidate)
 * 6. API routes → NetworkFirst
 * 7. defaultCache fallback
 * 
 * Safety Guardrails:
 * - NEVER cache: 401, 403, 302, 307, 308, or any non-ok response
 * - NEVER cache: POST, PUT, PATCH, DELETE requests
 * - Clear caches on user sign-out to prevent data leakage
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig, RuntimeCaching } from "serwist";
import {
  Serwist,
  NetworkFirst,
  CacheFirst,
  StaleWhileRevalidate,
  ExpirationPlugin,
  CacheableResponsePlugin,
} from "serwist";

// Type declarations for service worker globals
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// API base URL - replaced at build time by webpack
const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || "https://syjmdqcpr4.us-west-2.awsapprunner.com";

// Cache names - centralized for easy reference
const CACHE_NAMES = {
  NEXT_STATIC: "next-static",
  NEXT_RSC: "next-rsc",
  APP_ASSETS: "app-assets",
  PAGES: "pages",
  PAGES_PROJECTS: "pages-projects",
  RSC_PROJECTS: "rsc-projects",
  PYODIDE: "pyodide",
  API_PROJECTS: "api-projects",
  API_STUDY_PLAN: "api-study-plan",
} as const;

// Dev-only logging helper
const IS_DEV = process.env.NODE_ENV !== "production";
function logMatch(ruleName: string, pathname: string, search: string) {
  if (IS_DEV) {
    console.log(`[sw][match] ${ruleName} ${pathname}${search}`);
  }
}

// Detect mobile devices - WASM doesn't work on mobile, so we skip caching Pyodide
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  self.navigator?.userAgent || ""
);

// ============================================================================
// LIFECYCLE HANDLERS
// ============================================================================

/**
 * On activate: Clean up Pyodide cache on mobile devices.
 * Pyodide is precached for all users (for desktop performance), but mobile
 * devices can't use WASM anyway, so we delete it to save storage space.
 * This runs after install completes, so we're deleting already-cached assets.
 */
self.addEventListener("activate", (event) => {
  if (IS_MOBILE) {
    event.waitUntil(
      (async () => {
        // Delete the Pyodide precache to free up ~13MB on mobile
        // The precache uses a versioned cache name, so we need to find it
        const cacheNames = await caches.keys();

        await Promise.all(
          cacheNames.map(async (cacheName) => {
            // Delete any cache containing pyodide assets
            if (cacheName.includes("pyodide") || cacheName.includes("precache")) {
              const cache = await caches.open(cacheName);
              const keys = await cache.keys();

              // Delete only pyodide-related entries from precache
              await Promise.all(
                keys
                  .filter(req => {
                    const url = req.url;
                    // Clean up Pyodide (WASM) to save space on mobile
                    // WE NO LONGER delete project pages 0-6 as they are small and 
                    // beneficial for FCP/LCP when cached.
                    return url.includes("/pyodide/");
                  })
                  .map(req => {
                    console.log(`[SW] Mobile cleanup: deleting ${req.url}`);
                    return cache.delete(req);
                  })
              );
            }
          })
        );

        console.log("[SW] Mobile cleanup complete - Pyodide cache freed");
      })()
    );
  }
});

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

self.addEventListener("message", (event) => {
  const { type, urls } = event.data || {};

  switch (type) {
    case "CACHE_API_DATA":
      // Warm cache with specific API URLs (called after auth)
      // Now accepts an optional token for authenticated endpoints
      event.waitUntil(warmApiCache(urls, event.data.token));
      break;

    case "CLEAR_OFFLINE_CACHES":
      // Clear user-specific caches on logout
      event.waitUntil(clearUserCaches());
      break;

    case "INVALIDATE_PROJECTS_CACHE":
      // Invalidate projects-related caches after submission
      // This ensures /projects overview shows fresh progress data
      event.waitUntil(invalidateProjectsCaches());
      break;
  }
});

/**
 * Warm the API cache with specific URLs.
 * Called from client after successful auth to prefetch API data.
 * Applies same guardrails as runtime caching - never caches auth failures.
 */
async function warmApiCache(urls: string[], token?: string) {
  if (!urls?.length) return;

  const cache = await caches.open(CACHE_NAMES.API_PROJECTS);

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
          credentials: "include",
          headers
        });

        // Apply same guardrails: only cache successful GET responses
        if (isCacheableResponse(response)) {
          await cache.put(url, response.clone());
          console.log(`[SW] Warmed cache: ${url}`);
        } else {
          console.warn(`[SW] Skipped caching (status ${response.status}): ${url}`);
        }
      } catch (error) {
        console.warn(`[SW] Failed to warm cache: ${url}`, error);
      }
    })
  );
}

/**
 * Clear all user-specific caches.
 * Called on sign-out to prevent stale/wrong user data.
 */
async function clearUserCaches() {
  const cachesToClear = [
    CACHE_NAMES.PAGES,
    CACHE_NAMES.PAGES_PROJECTS,
    CACHE_NAMES.RSC_PROJECTS,
    CACHE_NAMES.API_PROJECTS,
    CACHE_NAMES.API_STUDY_PLAN,
  ];

  await Promise.all(
    cachesToClear.map(async (cacheName) => {
      try {
        const deleted = await caches.delete(cacheName);
        console.log(`[SW] Cleared cache "${cacheName}": ${deleted}`);
      } catch (error) {
        console.warn(`[SW] Failed to clear cache "${cacheName}":`, error);
      }
    })
  );
}

/**
 * Invalidate projects-related caches after a submission.
 * 
 * This is called after a successful project submission to ensure the /projects
 * overview page shows fresh progress data. Without this, users would see stale
 * "Not Started" status even after completing submissions.
 * 
 * Targets:
 * - api-projects: Clears /projects list API cache (stale aggregated progress)
 * - rsc-projects: Clears /projects RSC payloads (embedded stale data)
 * - pages-projects: Clears /projects navigation cache
 * 
 * Note: Only clears /projects (list) entries, NOT individual /projects/:id entries.
 * Individual project pages fetch submissions directly and are always fresh.
 */
async function invalidateProjectsCaches() {
  const cachesToInvalidate = [
    CACHE_NAMES.API_PROJECTS,
    CACHE_NAMES.RSC_PROJECTS,
    CACHE_NAMES.PAGES_PROJECTS,
  ];

  let totalDeleted = 0;

  await Promise.all(
    cachesToInvalidate.map(async (cacheName) => {
      try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();

        // Delete entries for /projects list (not individual /projects/:id)
        // The /projects API returns aggregated progress that becomes stale
        // Individual project pages fetch submissions directly
        const entriesToDelete = keys.filter(req => {
          const url = new URL(req.url);
          // Match /projects exactly (the list endpoint)
          // Also match /projects?... and /projects with RSC params
          return url.pathname === "/projects" || 
            (url.pathname === "/projects" && url.search);
        });

        await Promise.all(
          entriesToDelete.map(async (req) => {
            const deleted = await cache.delete(req);
            if (deleted) {
              totalDeleted++;
              console.log(`[SW] Invalidated: ${req.url}`);
            }
          })
        );
      } catch (error) {
        console.warn(`[SW] Failed to invalidate cache "${cacheName}":`, error);
      }
    })
  );

  console.log(`[SW] Projects cache invalidation complete. Deleted ${totalDeleted} entries.`);
}

/**
 * Check if a response is safe to cache.
 * Returns false for auth failures, redirects, and error responses.
 */
function isCacheableResponse(response: Response): boolean {
  // Never cache non-ok responses
  if (!response.ok) return false;

  // Never cache redirects (302, 307, 308)
  if (response.redirected) return false;

  // Never cache auth failures (401, 403) - redundant with !ok but explicit
  const status = response.status;
  if (status === 401 || status === 403) return false;

  // Only cache if status is 200 (strict)
  return status === 200;
}

// ============================================================================
// RUNTIME CACHING RULES
// ============================================================================

/**
 * Plugins for static asset caching.
 * Long expiration since these are content-hashed.
 */
const staticAssetPlugins = [
  new CacheableResponsePlugin({ statuses: [200] }),
  new ExpirationPlugin({
    maxEntries: 200,
    maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
  }),
];

/**
 * Plugins for app assets (icons, images).
 * Moderate expiration for non-hashed assets.
 */
const appAssetPlugins = [
  new CacheableResponsePlugin({ statuses: [200] }),
  new ExpirationPlugin({
    maxEntries: 100,
    maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
  }),
];

/**
 * Plugins for API caching.
 * Short expiration since this is user-specific data.
 * Only cache 200 responses (no auth failures, no redirects).
 * 
 * TTL reduced from 15 min → 5 min to minimize stale progress data.
 * Combined with cache invalidation on submission for immediate consistency.
 */
const apiCachePlugins = [
  new CacheableResponsePlugin({ statuses: [200] }),
  new ExpirationPlugin({
    maxEntries: 50,
    maxAgeSeconds: 5 * 60, // 5 minutes - reduced for user-specific progress data
  }),
];

/**
 * Plugins for page navigation caching.
 * Don't cache redirects or auth failures.
 */
const navigationPlugins = [
  new CacheableResponsePlugin({ statuses: [200] }),
  new ExpirationPlugin({
    maxEntries: 50,
    maxAgeSeconds: 24 * 60 * 60, // 24 hours
  }),
];

const runtimeCaching: RuntimeCaching[] = [
  // -------------------------------------------------------------------------
  // A) STATIC ASSETS - Next.js build output
  // -------------------------------------------------------------------------
  {
    matcher: ({ url }) => {
      // Match /_next/static/* - Next.js content-hashed assets
      const matches = url.origin === self.location.origin &&
        url.pathname.startsWith("/_next/static/");
      if (matches) logMatch("NEXT_STATIC", url.pathname, url.search);
      return matches;
    },
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.NEXT_STATIC,
      plugins: staticAssetPlugins,
    }),
  },

  // -------------------------------------------------------------------------
  // A) STATIC ASSETS - Pyodide (Python runtime for offline code execution)
  // -------------------------------------------------------------------------
  // Pyodide is precached at install for instant offline Python on desktop.
  // Mobile devices have the cache deleted on activate (see lifecycle handlers).
  // This runtime rule handles any additional Pyodide packages loaded dynamically.
  {
    matcher: ({ url }) => {
      // Skip on mobile - WASM doesn't work, and we delete the cache anyway
      if (IS_MOBILE) return false;

      // Match /pyodide/* - Python runtime assets (desktop only)
      const matches = url.origin === self.location.origin &&
        url.pathname.startsWith("/pyodide/");
      if (matches) logMatch("PYODIDE", url.pathname, url.search);
      return matches;
    },
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.PYODIDE,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days - these rarely change
        }),
      ],
    }),
  },

  // -------------------------------------------------------------------------
  // A) STATIC ASSETS - App icons, images, fonts (same origin only)
  // -------------------------------------------------------------------------
  {
    matcher: ({ url }) => {
      // Only cache same-origin assets (not third-party analytics/tracking)
      if (url.origin !== self.location.origin) return false;

      // Match /icons/*, /images/*, /fonts/*
      const matches = /^\/(icons|images|fonts)\//.test(url.pathname);
      if (matches) logMatch("APP_ASSETS", url.pathname, url.search);
      return matches;
    },
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.APP_ASSETS,
      plugins: appAssetPlugins,
    }),
  },

  // -------------------------------------------------------------------------
  // B) PROJECTS RSC REQUESTS - Explicit SWR for /projects RSC payloads
  // -------------------------------------------------------------------------
  // Next.js App Router sends RSC requests with ?_rsc= for client navigations.
  // This rule MUST come before the generic RSC rule to ensure /projects RSC
  // requests always use our dedicated cache.
  {
    matcher: ({ request, url }) => {
      // Only GET requests
      if (request.method !== "GET") return false;

      // Only same-origin
      if (url.origin !== self.location.origin) return false;

      // Must have _rsc query param
      if (!url.searchParams.has("_rsc")) return false;

      // Match only /projects or /projects/* paths
      const isProjects = url.pathname === "/projects" || url.pathname.startsWith("/projects/");
      if (isProjects) logMatch("PROJECTS_RSC_SWR", url.pathname, url.search);
      return isProjects;
    },
    handler: new StaleWhileRevalidate({
      cacheName: CACHE_NAMES.RSC_PROJECTS,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 3 * 60, // 3 minutes - reduced from 10 min for fresher progress data
        }),
      ],
    }),
  },

  // -------------------------------------------------------------------------
  // B) PROJECTS NAVIGATION - Explicit SWR for /projects page navigations
  // -------------------------------------------------------------------------
  // This rule MUST come before the generic navigation rule to ensure /projects
  // navigations ALWAYS use StaleWhileRevalidate, never NetworkFirst/NetworkOnly.
  // 
  // TTL reduced from 24h → 30min since /projects contains user-specific progress.
  {
    matcher: ({ request, url }) => {
      // Must be a navigation request
      if (request.mode !== "navigate") return false;

      // Only same-origin navigations
      if (url.origin !== self.location.origin) return false;

      // Relaxed destination check for Next.js App Router compatibility:
      // Next.js sometimes sends navigations with empty destination.
      const dest = request.destination;
      if (dest && dest !== "document") return false;

      // Match only /projects or /projects/* paths
      const isProjects = url.pathname === "/projects" || url.pathname.startsWith("/projects/");
      if (isProjects) logMatch("PROJECTS_NAV_SWR", url.pathname, url.search);
      return isProjects;
    },
    handler: new StaleWhileRevalidate({
      cacheName: CACHE_NAMES.PAGES_PROJECTS,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 30 * 60, // 30 minutes - reduced from 24h for user-specific progress
        }),
      ],
    }),
  },

  // -------------------------------------------------------------------------
  // B) NEXT.JS APP ROUTER RSC REQUESTS (generic, excludes /projects)
  // -------------------------------------------------------------------------
  // Next.js App Router uses RSC (React Server Components) requests with ?_rsc=
  // query param for client-side navigations. These are NOT mode="navigate" but
  // need to be cached for offline support.
  // 
  // Strategy: StaleWhileRevalidate for INSTANT offline experience
  // - If cached: serve immediately, update in background
  // - If not cached: fetch from network
  // - Result: zero latency when offline with cached content
  {
    matcher: ({ request, url }) => {
      // Only GET requests
      if (request.method !== "GET") return false;

      // Only same-origin
      if (url.origin !== self.location.origin) return false;

      // Exclude /projects - handled by dedicated rule above
      if (url.pathname === "/projects" || url.pathname.startsWith("/projects/")) return false;

      // Match requests with _rsc query param (Next.js App Router RSC)
      const matches = url.searchParams.has("_rsc");
      if (matches) logMatch("GENERIC_RSC_SWR", url.pathname, url.search);
      return matches;
    },
    handler: new StaleWhileRevalidate({
      cacheName: CACHE_NAMES.NEXT_RSC,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 10 * 60, // 10 minutes - RSC payloads can change
        }),
      ],
    }),
  },

  // -------------------------------------------------------------------------
  // B) NAVIGATION - Page requests with offline fallback (generic, excludes /projects)
  // -------------------------------------------------------------------------
  // Strategy: StaleWhileRevalidate for INSTANT offline experience
  // - If page is cached: serve immediately, refresh in background
  // - If not cached: fetch from network (first visit)
  // - Result: returning users get instant page loads, fresh content updates silently
  // 
  // Trade-off: Users might briefly see stale content, but it updates on next visit.
  // This is acceptable for our app where content doesn't change frequently.
  {
    matcher: ({ request, url }) => {
      // Primary check: must be a navigation request
      if (request.mode !== "navigate") return false;

      // Relaxed destination check for Next.js App Router compatibility:
      // Next.js sometimes sends navigations with empty destination.
      // Only reject if destination is explicitly set to something OTHER than document.
      const dest = request.destination;
      if (dest && dest !== "document") return false;

      // Only same-origin navigations
      if (url.origin !== self.location.origin) return false;

      // Skip API routes and Next.js internals
      if (url.pathname.startsWith("/api/")) return false;
      if (url.pathname.startsWith("/_next/")) return false;

      // Exclude /projects - handled by dedicated rule above
      if (url.pathname === "/projects" || url.pathname.startsWith("/projects/")) return false;

      logMatch("GENERIC_NAV_SWR", url.pathname, url.search);
      return true;
    },
    handler: new StaleWhileRevalidate({
      cacheName: CACHE_NAMES.PAGES,
      plugins: navigationPlugins,
    }),
  },

  // -------------------------------------------------------------------------
  // C) API - Projects (user-specific, needs auth guardrails)
  // -------------------------------------------------------------------------
  {
    matcher: ({ request, url }) => {
      // NEVER cache non-GET requests
      if (request.method !== "GET") return false;

      // Match backend API for projects
      const isBackendApi = url.origin.includes("awsapprunner.com") ||
        url.href.startsWith(API_BASE_URL);
      const matches = isBackendApi && url.pathname.includes("/projects");
      if (matches) logMatch("API_PROJECTS_NF", url.pathname, url.search);
      return matches;
    },
    handler: new NetworkFirst({
      // NetworkFirst for user-specific data: always try fresh first
      cacheName: CACHE_NAMES.API_PROJECTS,
      networkTimeoutSeconds: 5,
      plugins: apiCachePlugins,
    }),
  },

  // -------------------------------------------------------------------------
  // C) API - Study Plan / Planner (user-specific, needs auth guardrails)
  // -------------------------------------------------------------------------
  {
    matcher: ({ request, url }) => {
      // NEVER cache non-GET requests
      if (request.method !== "GET") return false;

      // Match backend API for study plan
      const isBackendApi = url.origin.includes("awsapprunner.com") ||
        url.href.startsWith(API_BASE_URL);
      const matches = isBackendApi &&
        (url.pathname.includes("/study-plan") || url.pathname.includes("/planner"));
      if (matches) logMatch("API_STUDY_PLAN_NF", url.pathname, url.search);
      return matches;
    },
    handler: new NetworkFirst({
      cacheName: CACHE_NAMES.API_STUDY_PLAN,
      networkTimeoutSeconds: 5,
      plugins: apiCachePlugins,
    }),
  },

  // -------------------------------------------------------------------------
  // C) API - Local Next.js API routes (also user-specific)
  // -------------------------------------------------------------------------
  {
    matcher: ({ request, url }) => {
      // NEVER cache non-GET requests
      if (request.method !== "GET") return false;

      // Match local API routes that should be cached
      if (url.origin !== self.location.origin) return false;

      // Only cache specific safe endpoints
      const cacheableApiRoutes = ["/api/study-plan", "/api/planner"];
      const matches = cacheableApiRoutes.some(route => url.pathname.startsWith(route));
      if (matches) logMatch("LOCAL_API_NF", url.pathname, url.search);
      return matches;
    },
    handler: new NetworkFirst({
      cacheName: CACHE_NAMES.API_STUDY_PLAN,
      networkTimeoutSeconds: 5,
      plugins: apiCachePlugins,
    }),
  },
];

// ============================================================================
// SERWIST INITIALIZATION
// ============================================================================

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    concurrency: 10,
    ignoreURLParametersMatching: [],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false, // Disabled - we handle navigation ourselves
  disableDevLogs: process.env.NODE_ENV === "production",

  // Custom runtime caching takes priority, then default cache rules.
  // In dev, @serwist/next's defaultCache is NetworkOnly for everything, which throws
  // "Failed to fetch" when offline or when the dev server is down. Use a fallback
  // that can serve from cache (StaleWhileRevalidate) so navigations like /projects/1
  // don't crash the app when the network request fails.
  runtimeCaching:
    process.env.NODE_ENV === "production"
      ? [...runtimeCaching, ...defaultCache]
      : [
          ...runtimeCaching,
          {
            matcher: /.*/i,
            handler: new StaleWhileRevalidate({
              cacheName: "dev-fallback",
              plugins: [
                new CacheableResponsePlugin({ statuses: [200] }),
                new ExpirationPlugin({
                  maxEntries: 64,
                  maxAgeSeconds: 24 * 60 * 60,
                }),
              ],
            }),
          },
        ],

  // Fallback to offline page when navigation fails
  // Note: /~offline is precached via additionalPrecacheEntries in next.config.js
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          // Match document navigations
          if (request.destination === "document") return true;

          // Also match navigations with empty destination (Next.js App Router)
          if (request.mode === "navigate") return true;

          return false;
        },
      },
    ],
  },
});

serwist.addEventListeners();
