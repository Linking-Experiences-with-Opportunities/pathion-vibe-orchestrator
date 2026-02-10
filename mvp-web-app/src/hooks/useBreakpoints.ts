"use client";

import { useState, useCallback } from "react";
import { BreakpointsMap } from "./useStepDebugger";

export interface UseBreakpointsResult {
  /** The raw breakpoints map: { [filename]: Set<lineNumber> } */
  breakpoints: BreakpointsMap;
  /** Toggle a breakpoint on/off for a given file and line. */
  toggle: (file: string, line: number) => void;
  /** Get the breakpoint line numbers for a specific file as a sorted array. */
  getForFile: (file: string) => number[];
  /** Returns true if any breakpoints are set across all files. */
  hasAny: () => boolean;
  /** Clear all breakpoints. */
  clearAll: () => void;
}

/**
 * Hook that manages breakpoints across multiple files.
 * Breakpoints are stored as { [filename]: Set<lineNumber> }.
 */
export function useBreakpoints(): UseBreakpointsResult {
  const [breakpoints, setBreakpoints] = useState<BreakpointsMap>({});

  const toggle = useCallback((file: string, line: number) => {
    setBreakpoints((prev) => {
      const next = { ...prev };
      const fileSet = new Set(prev[file] ?? []);

      if (fileSet.has(line)) {
        fileSet.delete(line);
      } else {
        fileSet.add(line);
      }

      if (fileSet.size === 0) {
        delete next[file];
      } else {
        next[file] = fileSet;
      }

      return next;
    });
  }, []);

  const getForFile = useCallback(
    (file: string): number[] => {
      const set = breakpoints[file];
      if (!set) return [];
      return Array.from(set).sort((a, b) => a - b);
    },
    [breakpoints]
  );

  const hasAny = useCallback((): boolean => {
    return Object.values(breakpoints).some((s) => s.size > 0);
  }, [breakpoints]);

  const clearAll = useCallback(() => {
    setBreakpoints({});
  }, []);

  return { breakpoints, toggle, getForFile, hasAny, clearAll };
}
