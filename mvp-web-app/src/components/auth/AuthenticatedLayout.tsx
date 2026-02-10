"use client";
import LoadingSpinner from "@/components/LoadingSpinner";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useSessionContext } from '@supabase/auth-helpers-react';
import useCohortStatus from "@/lib/useCohortStatus";
import { trackTelemetry, setTelemetryUserId, initializeTelemetry } from "@/lib/telemetryClient";
import { prefetchAllForOffline } from "@/lib/cacheApiForOffline";
import { GettingStartedChecklist, OnboardingProvider } from "@/components/onboarding";
import { ActionTrackingProvider } from "@/components/ActionTrackingProvider";
import { AttemptSessionProvider } from "@/components/AttemptSessionProvider";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const PUBLIC_PATHS = ["/", "/login", "/waitlist", "/register", "/forgot-password", "/unsupported", "/debug/runner", "/projects", "/problems"];
  const { session, isLoading } = useSessionContext();
  const [isNavigating, setIsNavigating] = useState(true);

  const router = useRouter();
  const pathname = usePathname();

  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const inCohort = useCohortStatus();
  const isAdminPath = pathname.startsWith("/admin");
  const isModulesPath = pathname.startsWith("/modules");
  const userIsAdmin = session?.user.email?.includes("@linkedinorleftout.com") ?? false;
  const [redirectChecked, setRedirectChecked] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    const isAuthed = !!session;

    if (!isAuthed && !isPublicPath) {
      router.replace("/login");
      return;
    }

    if (isAuthed && (pathname === "/login" || pathname === "/register")) {
      router.replace("/projects");
      return;
    }

    // 🔐 Redirect if user is on /admin but not admin
    if (isAdminPath && !userIsAdmin) {
      router.replace("/projects"); // Or "/unauthorized"
      return;
    }

    if (isModulesPath && !userIsAdmin) {
      if (inCohort === null) return; // wait for cohort check to finish
      if (!inCohort) {
        router.replace("/projects");
        return;
      }
    }

    // no redirects needed → safe to render page
    setRedirectChecked(true);
  }, [isLoading, session, pathname, isPublicPath, router, userIsAdmin, isAdminPath, isModulesPath, inCohort]);


  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  // Track page views for authenticated users (for "Last Seen" in admin dashboard)
  const lastTrackedPath = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.user?.email || isLoading) return;

    // Set user ID for all telemetry events
    initializeTelemetry(session);

    // Only track if path changed (avoid duplicate tracking on re-renders)
    if (lastTrackedPath.current === pathname) return;
    lastTrackedPath.current = pathname;

    // Fire page_view event - this ensures "Last Seen" is recorded for any platform activity
    trackTelemetry("page_view", {
      path: pathname,
    });
  }, [session, pathname, isLoading]);

  // Prioritize Pyodide warmup, then schedule offline prefetch
  const hasPrefetched = useRef(false);
  useEffect(() => {
    if (!session || isLoading || hasPrefetched.current) return;

    const accessToken = session.access_token;
    if (accessToken) {
      hasPrefetched.current = true;

      // 1. Start Pyodide warmup IMMEDIATELY (Critical Path)
      import("@/lib/PyodideWarmupManager").then(({ pyodideWarmupManager }) => {
        pyodideWarmupManager.startWarmup();

        // 2. Defer offline prefetch until Pyodide is ready + browser is idle
        pyodideWarmupManager.scheduleIdleWork(() => {
          prefetchAllForOffline(accessToken).catch(console.warn);
        });
      });
    }
  }, [session, isLoading]);

  // Show loading spinner during initial load OR during navigation
  if (!redirectChecked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  // Define paths where onboarding should NOT show
  const ONBOARDING_EXCLUDED_PATHS = ["/", "/login", "/register", "/forgot-password", "/unsupported", "/admin", "/waitlist"];
  const shouldShowOnboarding = session && !ONBOARDING_EXCLUDED_PATHS.some(p =>
    pathname === p || pathname.startsWith("/admin")
  );

  return (
    <OnboardingProvider>
      <ActionTrackingProvider>
        <AttemptSessionProvider>
          {children}
        </AttemptSessionProvider>
      </ActionTrackingProvider>
      {/* Onboarding widget - only shows for authenticated users on app screens */}
      {/* {shouldShowOnboarding && <GettingStartedChecklist />} */}
    </OnboardingProvider>
  );
}