/**
 * useNavigation - Navigation hierarchy, guards, and directional navigation
 * 
 * Provides:
 * - Route hierarchy awareness (parent/sibling navigation)
 * - Unsaved changes guard (prevents accidental exits)
 * - Directional navigation (up/down in route hierarchy)
 * 
 * Route Hierarchy:
 * /                              (landing)
 * /dashboard
 * /modules
 * /modules/[id]                  (module detail with lessons)
 * /lessons/[lesson_name]         (individual lesson)
 * /projects
 * /projects/[id]                 (project workspace)
 * /problems
 * /problems/[id]                 (problem workspace)
 * /settings
 * /boss-fight                    (new)
 * /boss-fight/[id]               (active fight)
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

// ============================================================================
// Route Hierarchy Definition
// ============================================================================

interface RouteNode {
  parent: string | null;
  pattern: RegExp;
  siblingPattern?: RegExp; // Pattern for sibling routes (for next/prev navigation)
}

/**
 * Route hierarchy map. Each route knows its parent for "move up" navigation.
 */
const ROUTE_HIERARCHY: RouteNode[] = [
  // Top level
  { pattern: /^\/$/, parent: null },
  { pattern: /^\/dashboard$/, parent: "/" },
  { pattern: /^\/settings$/, parent: "/dashboard" },
  
  // Modules
  { pattern: /^\/modules$/, parent: "/dashboard" },
  { pattern: /^\/modules\/[^/]+$/, parent: "/modules", siblingPattern: /^\/modules\/[^/]+$/ },
  
  // Lessons
  { pattern: /^\/lessons$/, parent: "/modules" },
  { pattern: /^\/lessons\/[^/]+$/, parent: "/lessons", siblingPattern: /^\/lessons\/[^/]+$/ },
  
  // Projects
  { pattern: /^\/projects$/, parent: "/dashboard" },
  { pattern: /^\/projects\/[^/]+$/, parent: "/projects", siblingPattern: /^\/projects\/[^/]+$/ },
  
  // Problems
  { pattern: /^\/problems$/, parent: "/dashboard" },
  { pattern: /^\/problems\/[^/]+$/, parent: "/problems", siblingPattern: /^\/problems\/[^/]+$/ },
  
  // Study plan
  { pattern: /^\/study-plan$/, parent: "/dashboard" },
  
  // Boss fight
  { pattern: /^\/boss-fight$/, parent: "/dashboard" },
  { pattern: /^\/boss-fight\/[^/]+$/, parent: "/boss-fight" },
];

/**
 * Find the route node for a given pathname
 */
function findRouteNode(pathname: string): RouteNode | null {
  for (const node of ROUTE_HIERARCHY) {
    if (node.pattern.test(pathname)) {
      return node;
    }
  }
  return null;
}

// ============================================================================
// useNavigation Hook
// ============================================================================

interface NavigationInfo {
  /** The parent route (for "move up" navigation) */
  parentPath: string | null;
  /** Whether the current route has a parent */
  canGoUp: boolean;
  /** Navigate to parent route */
  goUp: () => void;
  /** Current pathname */
  currentPath: string;
}

/**
 * Hook that provides directional navigation based on route hierarchy
 */
export function useNavigation(): NavigationInfo {
  const pathname = usePathname();
  const router = useRouter();

  const node = findRouteNode(pathname);
  const parentPath = node?.parent ?? null;

  const goUp = useCallback(() => {
    if (parentPath) {
      router.push(parentPath);
    }
  }, [parentPath, router]);

  return {
    parentPath,
    canGoUp: parentPath !== null,
    goUp,
    currentPath: pathname,
  };
}

// ============================================================================
// useUnsavedChangesGuard Hook
// ============================================================================

interface UnsavedChangesGuardOptions {
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Custom message for the confirmation dialog */
  message?: string;
}

/**
 * Hook that prevents accidental page exits when there are unsaved changes.
 * Uses beforeunload for browser navigation and a warning for Next.js navigation.
 */
export function useUnsavedChangesGuard({
  hasUnsavedChanges,
  message = "You have unsaved changes. Are you sure you want to leave?",
}: UnsavedChangesGuardOptions): void {
  const hasUnsavedRef = useRef(hasUnsavedChanges);
  hasUnsavedRef.current = hasUnsavedChanges;

  // Browser navigation guard (refresh, close tab, external navigation)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedRef.current) return;
      e.preventDefault();
      // Modern browsers ignore custom messages but still show a generic prompt
      e.returnValue = message;
      return message;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [message]);
}

// ============================================================================
// useBossFightGuard Hook
// ============================================================================

/**
 * Hook that prevents all navigation on boss fight pages except explicit "quit" action.
 * Shows a strong warning if the user tries to navigate away.
 */
export function useBossFightGuard(isActive: boolean): {
  /** Call this to allow navigation (e.g., when user explicitly quits) */
  allowNavigation: () => void;
} {
  const allowRef = useRef(false);

  useEffect(() => {
    if (!isActive) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowRef.current) return;
      e.preventDefault();
      const msg = "Leaving will abandon your boss fight! Are you sure?";
      e.returnValue = msg;
      return msg;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isActive]);

  const allowNavigation = useCallback(() => {
    allowRef.current = true;
  }, []);

  return { allowNavigation };
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

/**
 * Hook that adds keyboard shortcuts for directional navigation
 * - Alt+Up: Navigate to parent route
 */
export function useNavigationShortcuts(): void {
  const { goUp, canGoUp } = useNavigation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + Up Arrow: Go to parent route
      if (e.altKey && e.key === "ArrowUp" && canGoUp) {
        e.preventDefault();
        goUp();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goUp, canGoUp]);
}
