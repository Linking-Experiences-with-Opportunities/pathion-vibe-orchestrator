"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  initActionLogger,
  logPageEnter,
  logPageExit,
  logTabVisibility,
  forceFlush,
} from "@/lib/actionLogger";

/**
 * Hook for tracking page lifecycle events
 * Automatically logs page enter/exit and time on page
 */
export function usePageTracking(metadata?: Record<string, unknown>) {
  const pathname = usePathname();
  const enterTimeRef = useRef<number>(Date.now());
  const lastPathnameRef = useRef<string>(pathname);

  useEffect(() => {
    // Log page enter
    enterTimeRef.current = Date.now();
    logPageEnter(pathname, metadata);

    return () => {
      // Log page exit with time on page
      const timeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(pathname, timeOnPage, metadata);
    };
  }, [pathname, metadata]);

  // Track pathname changes for SPA navigation
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      // Log exit from previous page
      const timeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(lastPathnameRef.current, timeOnPage);

      // Log enter to new page
      enterTimeRef.current = Date.now();
      logPageEnter(pathname, metadata);

      lastPathnameRef.current = pathname;
    }
  }, [pathname, metadata]);
}

/**
 * Hook for tracking tab visibility changes (with debounce)
 */
export function useTabVisibilityTracking() {
  useEffect(() => {
    let lastVisibilityChange = 0;
    const DEBOUNCE_MS = 1000;

    const handleVisibilityChange = () => {
      const now = Date.now();
      // Debounce rapid visibility changes
      if (now - lastVisibilityChange < DEBOUNCE_MS) {
        return;
      }
      lastVisibilityChange = now;
      
      const isVisible = document.visibilityState === "visible";
      logTabVisibility(isVisible);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}

/**
 * Combined hook for all action tracking
 * Use this in your app layout or root component
 */
export function useActionTracking() {
  const pathname = usePathname();
  const enterTimeRef = useRef<number>(Date.now());
  const lastPathnameRef = useRef<string>(pathname);
  const isInitializedRef = useRef(false);

  // Initialize action logger once
  useEffect(() => {
    if (!isInitializedRef.current) {
      initActionLogger();
      isInitializedRef.current = true;
    }
  }, []);

  // Page lifecycle tracking
  useEffect(() => {
    // Log page enter on mount
    enterTimeRef.current = Date.now();
    logPageEnter(pathname);

    return () => {
      // Log page exit on unmount
      const timeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(pathname, timeOnPage);
    };
  }, [pathname]);

  // Track pathname changes for SPA navigation
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      // Log exit from previous page
      const timeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(lastPathnameRef.current, timeOnPage);

      // Log enter to new page
      enterTimeRef.current = Date.now();
      logPageEnter(pathname);

      lastPathnameRef.current = pathname;
    }
  }, [pathname]);

  // Tab visibility tracking with debounce
  useEffect(() => {
    let lastVisibilityChange = 0;
    const DEBOUNCE_MS = 1000;

    const handleVisibilityChange = () => {
      const now = Date.now();
      const isVisible = document.visibilityState === "visible";
      
      // Debounce rapid visibility changes
      if (now - lastVisibilityChange < DEBOUNCE_MS) {
        return;
      }
      lastVisibilityChange = now;
      
      logTabVisibility(isVisible);

      // Flush events when tab becomes hidden (throttled at actionLogger level)
      if (!isVisible) {
        forceFlush();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}

/**
 * Hook for tracking clicks on elements with data-track attribute
 * Returns a ref that should be attached to a container element
 */
export function useClickTracking() {
  const handleClick = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const trackableElement = target.closest("[data-track]");

    if (trackableElement) {
      const trackId = trackableElement.getAttribute("data-track");
      const trackMeta = trackableElement.getAttribute("data-track-meta");

      let metadata: Record<string, unknown> = {
        tagName: target.tagName,
        path: window.location.pathname,
      };

      if (trackMeta) {
        try {
          metadata = { ...metadata, ...JSON.parse(trackMeta) };
        } catch {
          // Invalid JSON, ignore
        }
      }

      // Import dynamically to avoid circular dependencies
      import("@/lib/actionLogger").then(({ logButtonClick }) => {
        logButtonClick(trackId || "unknown", metadata);
      });
    }
  }, []);

  useEffect(() => {
    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, [handleClick]);
}
