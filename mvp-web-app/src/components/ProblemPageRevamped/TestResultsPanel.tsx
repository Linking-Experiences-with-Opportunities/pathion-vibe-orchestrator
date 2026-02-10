"use client";

/**
 * Re-export of the canonical TestResultsPanel from ProjectPageRevamped.
 * The standard implementation lives in ProjectPageRevamped/TestResultsPanel.tsx;
 * Problem page uses it with mode="problem".
 */
export {
  TestResultsPanel,
  type TestResultsPanelProps,
  type ProblemTestResultsPanelProps,
  type ProjectTestResultsPanelProps,
} from "../ProjectPageRevamped/TestResultsPanel";
