"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSessionContext } from "@supabase/auth-helpers-react";
import {
  initActionLogger,
  logPageEnter,
  logPageExit,
  logTabVisibility,
  logButtonClick,
  forceFlush,
} from "@/lib/actionLogger";
import { initProfileManager, cleanupProfileManager } from "@/lib/profileManager";
import { initActiveTimeTracker, cleanupActiveTimeTracker, markActiveTime, getActiveTimeSince } from "@/lib/activeTimeTracker";
import {
  startSessionArtifactScheduler,
  forceFlushSessionArtifacts,
} from "@/lib/attemptSession";

/**
 * ActionTrackingProvider - Initializes comprehensive user action tracking
 * 
 * Features:
 * - Page lifecycle tracking (enter/exit with time on page)
 * - Tab visibility tracking (focus/blur)
 * - Global click tracking (elements with data-track attribute)
 * - Session management
 * 
 * Usage:
 * Add data-track="button-name" to any element you want to track clicks on.
 * Optionally add data-track-meta='{"key": "value"}' for additional metadata.
 */
export function ActionTrackingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, isLoading } = useSessionContext();
  
  const isInitializedRef = useRef(false);
  const enterTimeRef = useRef<number>(Date.now());
  const activeTimeMarkRef = useRef<number>(0);
  const lastPathnameRef = useRef<string>(pathname);

  // Initialize action logger and profile manager once when session is available
  useEffect(() => {
    if (isLoading || !session) return;
    if (isInitializedRef.current) return;

    initActionLogger();
    startSessionArtifactScheduler();
    initProfileManager();
    initActiveTimeTracker();
    isInitializedRef.current = true;
    
    console.log("[ActionTracking] Initialized for user:", session.user.id);

    return () => {
      cleanupProfileManager();
      cleanupActiveTimeTracker();
    };
  }, [session, isLoading]);

  // Page lifecycle tracking
  useEffect(() => {
    if (!isInitializedRef.current) return;

    // Log page enter on mount
    enterTimeRef.current = Date.now();
    activeTimeMarkRef.current = markActiveTime();
    logPageEnter(pathname, {
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
    });

    return () => {
      // Log page exit on unmount — use active time (excludes idle gaps >20s)
      const activeTimeOnPage = getActiveTimeSince(activeTimeMarkRef.current);
      const wallTimeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(pathname, activeTimeOnPage, { wallTimeOnPage });
    };
  }, [pathname]);

  // Track pathname changes for SPA navigation
  useEffect(() => {
    if (!isInitializedRef.current) return;
    
    if (lastPathnameRef.current !== pathname && lastPathnameRef.current) {
      // Log exit from previous page — use active time (excludes idle gaps >20s)
      const activeTimeOnPage = getActiveTimeSince(activeTimeMarkRef.current);
      const wallTimeOnPage = Date.now() - enterTimeRef.current;
      logPageExit(lastPathnameRef.current, activeTimeOnPage, { wallTimeOnPage });

      // Log enter to new page
      enterTimeRef.current = Date.now();
      activeTimeMarkRef.current = markActiveTime();
      logPageEnter(pathname);
    }
    
    lastPathnameRef.current = pathname;
  }, [pathname]);

  // Tab visibility tracking with debounced flush
  useEffect(() => {
    if (!isInitializedRef.current) return;

    let lastVisibilityChange = 0;
    let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 1000; // Debounce rapid visibility changes

    const handleVisibilityChange = () => {
      const now = Date.now();
      const isVisible = document.visibilityState === "visible";
      
      // Debounce rapid visibility changes (e.g., quick tab switching)
      if (now - lastVisibilityChange < DEBOUNCE_MS) {
        // Skip logging if this is a rapid toggle
        return;
      }
      lastVisibilityChange = now;
      
      logTabVisibility(isVisible);

      // Flush events when tab becomes hidden (debounced)
      if (!isVisible) {
        // Clear any pending flush
        if (flushTimeoutId) {
          clearTimeout(flushTimeoutId);
        }
        // Delay flush slightly to batch rapid changes
        flushTimeoutId = setTimeout(() => {
          forceFlush();
          forceFlushSessionArtifacts();
          flushTimeoutId = null;
        }, 100);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (flushTimeoutId) {
        clearTimeout(flushTimeoutId);
      }
    };
  }, []);

  // Global click tracking for data-track elements
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const trackableElement = target.closest("[data-track]");

      if (trackableElement) {
        const trackId = trackableElement.getAttribute("data-track");
        const trackMeta = trackableElement.getAttribute("data-track-meta");

        let metadata: Record<string, unknown> = {
          tagName: (trackableElement as HTMLElement).tagName,
          path: pathname,
        };

        // Parse additional metadata if provided
        if (trackMeta) {
          try {
            metadata = { ...metadata, ...JSON.parse(trackMeta) };
          } catch {
            // Invalid JSON, ignore
          }
        }

        logButtonClick(trackId || "unknown", metadata);
      }
    };

    // Use capture phase to ensure we catch clicks before they might be stopped
    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, [pathname]);

  // Flush on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      forceFlush();
      forceFlushSessionArtifacts();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return <>{children}</>;
}

export default ActionTrackingProvider;
