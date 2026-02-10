"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSessionContext } from "@supabase/auth-helpers-react";
import { usePathname } from "next/navigation";
import { trackTelemetry } from "@/lib/telemetryClient";
import { ONBOARDING_EVENTS, WarmupSubmittedEventDetail } from "@/lib/onboardingEvents";

export type StepStatus = "pending" | "current" | "completed";

export interface ChecklistStep {
  id: number;
  title: string;
  ctaLabel: string;
  helperText?: string;
  status: StepStatus;
  route?: string;
}

/**
 * Onboarding state stored in localStorage.
 * 
 * IMPORTANT: This is UI state only, NOT the source of truth for analytics.
 * 
 * Source of truth for activation metrics:
 * - Backend submissions table (first submission where projectNumber >= 1)
 * - Telemetry events: "activated", "first_submission_real_project"
 * 
 * localStorage is used for:
 * - Persisting checklist progress across page loads (same device)
 * - UI preferences (collapsed state)
 * - Showing the correct celebration screen
 * 
 * It is NOT reliable for cross-device or incognito scenarios.
 */
interface OnboardingState {
  // UI preferences
  onboardingSeenAt: string | null;
  isCollapsed: boolean;
  // Step completion tracking (UI only)
  projectViewedAt: string | null;
  codeRunAt: string | null;
  // Demo project submission (Project Zero) - does NOT count as true activation
  demoProjectActivatedAt: string | null;
  // Real project activation (Project 1+) - TRUE activation
  // NOTE: For analytics, use backend submissions as source of truth
  trueActivatedAt: string | null;
  // Second project viewed (for Step 4)
  project1ViewedAt: string | null;
}

const DEFAULT_STATE: OnboardingState = {
  onboardingSeenAt: null,
  isCollapsed: true,
  projectViewedAt: null,
  codeRunAt: null,
  demoProjectActivatedAt: null,
  trueActivatedAt: null,
  project1ViewedAt: null,
};

function getStorageKey(userId: string): string {
  return `lilo_onboarding_v2_${userId}`;
}

function loadState(userId: string): OnboardingState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const stored = localStorage.getItem(getStorageKey(userId));
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migration: handle old state format
      if (parsed.firstSubmissionAt && !parsed.demoProjectActivatedAt && !parsed.trueActivatedAt) {
        // Old format - treat as demo project activated (conservative)
        parsed.demoProjectActivatedAt = parsed.firstSubmissionAt;
        delete parsed.firstSubmissionAt;
      }
      // Migration: handle warmupSubmittedAt -> demoProjectActivatedAt
      if (parsed.warmupSubmittedAt && !parsed.demoProjectActivatedAt) {
        parsed.demoProjectActivatedAt = parsed.warmupSubmittedAt;
        delete parsed.warmupSubmittedAt;
      }
      // Migration: handle activatedAt -> trueActivatedAt
      if (parsed.activatedAt && !parsed.trueActivatedAt) {
        parsed.trueActivatedAt = parsed.activatedAt;
        delete parsed.activatedAt;
      }
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load onboarding state:", e);
  }
  return DEFAULT_STATE;
}

function saveState(userId: string, state: OnboardingState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save onboarding state:", e);
  }
}

/**
 * Hook to manage onboarding checklist state
 * 
 * The onboarding widget guides users through Project Zero (demo project).
 * 
 * Returns null if:
 * - User is not authenticated
 * - User has completed Project Zero (demoProjectActivatedAt is set)
 */
export function useOnboardingChecklist() {
  const { session, isLoading } = useSessionContext();
  const pathname = usePathname();
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [initialized, setInitialized] = useState(false);
  const [showDemoProjectSuccess, setShowDemoProjectSuccess] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; projectNumber: number; isCompleted?: boolean; passedTests?: number }>>([]);

  const userId = session?.user?.id;

  // Load state on mount and when userId changes
  useEffect(() => {
    if (userId) {
      const loaded = loadState(userId);
      setState(loaded);
      setInitialized(true);
    }
  }, [userId]);

  // Fetch projects to get Project 0 and Project 1 IDs
  useEffect(() => {
    if (!session) return;

    const fetchProjects = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (e) {
        console.warn("Failed to fetch projects for onboarding:", e);
      }
    };

    fetchProjects();
  }, [session]);

  // Persist state changes
  useEffect(() => {
    if (userId && initialized) {
      saveState(userId, state);
    }
  }, [userId, state, initialized]);

  // Auto-expand once on first authenticated session (if user hasn't completed onboarding)
  // Skip auto-expansion on mobile to avoid covering too much screen real estate
  useEffect(() => {
    if (!initialized || !userId) return;

    // Don't auto-expand if onboarding is already complete (Project Zero done + Project 1 viewed)
    const onboardingAlreadyComplete = state.demoProjectActivatedAt && state.project1ViewedAt;

    if (!state.onboardingSeenAt && !onboardingAlreadyComplete) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        typeof window !== "undefined" ? window.navigator.userAgent : ""
      ) || (typeof window !== "undefined" && window.innerWidth < 1024);

      setState(prev => ({
        ...prev,
        onboardingSeenAt: new Date().toISOString(),
        isCollapsed: isMobile ? true : false,
      }));

      trackTelemetry("onboarding_auto_expanded", {
        userId,
        isMobile,
      });
    }
  }, [initialized, userId, state.onboardingSeenAt, state.demoProjectActivatedAt, state.project1ViewedAt]);

  // Get the "first" project (lowest projectNumber) for Step 1
  // This should be Project 0 (warmup) if it exists
  const firstProject = useMemo(() => {
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) => a.projectNumber - b.projectNumber)[0];
  }, [projects]);

  // Sync localStorage with backend: if Project 0 is already completed but localStorage doesn't know
  useEffect(() => {
    if (!initialized || !userId || projects.length === 0) return;

    const projectZero = projects.find(p => p.projectNumber === 0);
    const realProjects = projects.filter(p => p.projectNumber >= 1);
    
    // Check if any real project has been started (has passed tests or is completed)
    // This indicates the user has moved past Project Zero
    const hasStartedRealProject = realProjects.some(p => 
      p.isCompleted || (p.passedTests !== undefined && p.passedTests > 0)
    );
    
    let updates: Partial<OnboardingState> = {};

    // If Project 0 is marked as completed in the backend but not in localStorage, sync it
    if (projectZero?.isCompleted && !state.demoProjectActivatedAt) {
      updates.demoProjectActivatedAt = new Date().toISOString();
      console.log('📝 Synced Project Zero completion from backend to localStorage');
    }

    // If user has started any real project but localStorage doesn't know, sync it
    if (hasStartedRealProject && !state.project1ViewedAt) {
      updates.project1ViewedAt = new Date().toISOString();
      console.log('📝 Synced real project start from backend to localStorage');
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      setState(prev => ({
        ...prev,
        ...updates,
      }));
    }
  }, [initialized, userId, projects, state.demoProjectActivatedAt, state.project1ViewedAt]);

  // Get the "second" project (first real project, projectNumber >= 1) for navigation after completing demo
  const secondProject = useMemo(() => {
    if (projects.length === 0) return null;
    const realProjects = projects.filter(p => p.projectNumber >= 1);
    if (realProjects.length === 0) return null;
    return [...realProjects].sort((a, b) => a.projectNumber - b.projectNumber)[0];
  }, [projects]);

  // Track project views from pathname
  useEffect(() => {
    if (!initialized || !pathname || !userId) return;

    // Check if on a project page
    const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      const projectId = projectMatch[1];

      // Find the project to get its number
      const project = projects.find(p => p.id === projectId);

      if (project) {
        // Step 1: View first project (Project 0 warmup)
        if (firstProject && project.id === firstProject.id && !state.projectViewedAt) {
          setState(prev => ({
            ...prev,
            projectViewedAt: new Date().toISOString(),
          }));
          trackTelemetry("onboarding_step_completed", {
            step: 1,
            stepName: "project_viewed",
            projectNumber: project.projectNumber,
          });
        }
        // Step 4: View first real project (only if Step 3 demo project submit is complete)
        else if (secondProject && project.id === secondProject.id && !state.project1ViewedAt && state.demoProjectActivatedAt) {
          setState(prev => ({
            ...prev,
            project1ViewedAt: new Date().toISOString(),
          }));
          trackTelemetry("onboarding_step_completed", {
            step: 4,
            stepName: "real_project_viewed",
            projectNumber: project.projectNumber,
          });
        }
      }
    }
  }, [pathname, initialized, userId, state.projectViewedAt, state.project1ViewedAt, state.demoProjectActivatedAt, projects, firstProject, secondProject]);

  // Listen for onboarding events
  useEffect(() => {
    if (!initialized || !userId) return;

    // Handle code run (Step 2)
    const handleCodeRun = () => {
      if (!state.codeRunAt) {
        setState(prev => ({
          ...prev,
          codeRunAt: new Date().toISOString(),
        }));
        trackTelemetry("onboarding_step_completed", {
          step: 2,
          stepName: "code_run",
        });
      }
    };

    // Handle demo project submission (Project Zero) - Step 3
    // This does NOT set true activation!
    const handleDemoProjectSubmitted = (event: Event) => {
      const customEvent = event as CustomEvent<WarmupSubmittedEventDetail>;
      const { projectId, projectNumber } = customEvent.detail;

      if (!state.demoProjectActivatedAt) {
        setState(prev => ({
          ...prev,
          demoProjectActivatedAt: new Date().toISOString(),
        }));

        trackTelemetry("demo_project_submitted", {
          projectId,
          projectNumber,
        });

        trackTelemetry("onboarding_step_completed", {
          step: 3,
          stepName: "demo_project_submitted",
          projectNumber,
        });

        // Show demo project success message briefly
        setShowDemoProjectSuccess(true);
        setTimeout(() => {
          setShowDemoProjectSuccess(false);
        }, 4000);
      }
    };

    window.addEventListener(ONBOARDING_EVENTS.CODE_RUN, handleCodeRun);
    window.addEventListener(ONBOARDING_EVENTS.WARMUP_SUBMITTED, handleDemoProjectSubmitted);

    return () => {
      window.removeEventListener(ONBOARDING_EVENTS.CODE_RUN, handleCodeRun);
      window.removeEventListener(ONBOARDING_EVENTS.WARMUP_SUBMITTED, handleDemoProjectSubmitted);
    };
  }, [initialized, userId, state.codeRunAt, state.demoProjectActivatedAt]);

  // Get project IDs for routing
  const firstProjectId = firstProject?.id || null;
  const secondProjectId = secondProject?.id || null;

  // Build steps with current status (4 steps for Project Zero onboarding)
  const steps: ChecklistStep[] = useMemo(() => {
    const step1Done = !!state.projectViewedAt;
    const step2Done = !!state.codeRunAt;
    const step3Done = !!state.demoProjectActivatedAt;
    const step4Done = !!state.project1ViewedAt;

    const getStatus = (stepDone: boolean, prevDone: boolean): StepStatus => {
      if (stepDone) return "completed";
      if (prevDone) return "current";
      return "pending";
    };

    // Dynamic labels based on actual projects
    const firstProjectLabel = firstProject
      ? `Open ${firstProject.projectNumber === 0 ? "Project Zero" : `Project ${firstProject.projectNumber}`}`
      : "Open your first project";

    const secondProjectLabel = secondProject
      ? `Start Project ${secondProject.projectNumber}`
      : "Start Project 1";

    return [
      {
        id: 1,
        title: "Open the warm-up project",
        ctaLabel: firstProjectLabel,
        status: getStatus(step1Done, true),
        route: firstProjectId ? `/projects/${firstProjectId}` : "/projects",
      },
      {
        id: 2,
        title: "Run the starter code",
        ctaLabel: "Run Code",
        helperText: "Click the Run button to execute your code.",
        status: getStatus(step2Done, step1Done),
        route: firstProjectId ? `/projects/${firstProjectId}` : "/projects",
      },
      {
        id: 3,
        title: "Submit once (even if it fails)",
        ctaLabel: "Submit",
        helperText: "Submitting is how you get feedback. Failing is normal.",
        status: getStatus(step3Done, step2Done),
        route: firstProjectId ? `/projects/${firstProjectId}` : "/projects",
      },
      {
        id: 4,
        title: "Start your first real project",
        ctaLabel: secondProjectLabel,
        helperText: "You're ready for the real thing!",
        status: getStatus(step4Done, step3Done),
        route: secondProjectId ? `/projects/${secondProjectId}` : "/projects",
      },
    ];
  }, [state, firstProjectId, secondProjectId, firstProject, secondProject]);

  // Calculate completion
  const completedCount = steps.filter(s => s.status === "completed").length;
  const isAllComplete = completedCount === steps.length;

  // Check if user has completed Project Zero and started Project 1
  const isDemoProjectActivated = !!state.demoProjectActivatedAt;
  const hasStartedProject1 = !!state.project1ViewedAt;
  const isOnboardingComplete = isDemoProjectActivated && hasStartedProject1;

  // Toggle collapsed state
  const toggleCollapsed = useCallback(() => {
    setState(prev => ({
      ...prev,
      isCollapsed: !prev.isCollapsed,
    }));
  }, []);

  // Expand the widget
  const expand = useCallback(() => {
    setState(prev => ({
      ...prev,
      isCollapsed: false,
    }));
  }, []);

  // Collapse the widget
  const collapse = useCallback(() => {
    setState(prev => ({
      ...prev,
      isCollapsed: true,
    }));
  }, []);

  // Don't show if not authenticated or still loading
  if (isLoading || !session) {
    return null;
  }

  // Don't show widget if user has completed all onboarding steps (Project Zero + started Project 1)
  if (isOnboardingComplete) {
    return null;
  }

  // Don't show on Project 0 page - user is already there doing the warm-up
  if (firstProjectId && pathname === `/projects/${firstProjectId}`) {
    return null;
  }

  return {
    steps,
    completedCount,
    totalSteps: steps.length,
    isAllComplete,
    isDemoProjectActivated,
    hasStartedProject1,
    isOnboardingComplete,
    showDemoProjectSuccess,
    isCollapsed: state.isCollapsed,
    toggleCollapsed,
    expand,
    collapse,
    firstProjectId,
    secondProjectId,
  };
}

export type OnboardingChecklistHook = ReturnType<typeof useOnboardingChecklist>;
