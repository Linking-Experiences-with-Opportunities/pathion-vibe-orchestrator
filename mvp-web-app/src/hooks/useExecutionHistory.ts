"use client";

import { useState, useCallback, useMemo } from "react";

const MAX_HISTORY = 50;

/**
 * Result from a single test within a shadow run snapshot.
 */
export interface TestSnapshotResult {
  testName: string;
  passed: boolean;
  output: unknown;
  error?: string;
}

/**
 * A snapshot of a single shadow run execution.
 */
export interface ExecutionSnapshot {
  id: string;
  timestamp: number;
  runNumber: number;
  code: string;
  codeHash: string;
  results: TestSnapshotResult[];
  success: boolean;
  passCount: number;
  failCount: number;
  durationMs: number;
  terminated: boolean;
}

/**
 * Simple string hash function (djb2 variant).
 * Fast and sufficient for deduplication purposes.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export interface UseExecutionHistoryResult {
  /** Full history of execution snapshots (oldest first) */
  history: ExecutionSnapshot[];
  /** The most recent snapshot, or null if no runs yet */
  latest: ExecutionSnapshot | null;
  /** Pass rate per run as a number between 0 and 1 */
  passRateOverTime: number[];
  /** Whether a regression has been detected (a previously passing test now fails) */
  regressionDetected: boolean;
  /** Add a new snapshot to history */
  addSnapshot: (params: AddSnapshotParams) => void;
  /** Clear all history */
  clear: () => void;
}

export interface AddSnapshotParams {
  code: string;
  result: {
    success: boolean;
    output: unknown;
    error?: string;
    stdout?: string;
    stderr?: string;
  };
  timestamp: number;
  /** Optional per-test results, if available */
  testResults?: TestSnapshotResult[];
  /** Duration of the execution in milliseconds */
  durationMs?: number;
  /** Whether the worker was terminated (timeout/infinite loop) */
  terminated?: boolean;
}

/**
 * Hook that accumulates execution snapshots from shadow runs.
 * Purely a data store -- no worker logic.
 *
 * Deduplicates consecutive runs with the same code hash.
 * Caps history at MAX_HISTORY entries.
 * Derives regression detection from the last two entries.
 */
export function useExecutionHistory(): UseExecutionHistoryResult {
  const [history, setHistory] = useState<ExecutionSnapshot[]>([]);

  const addSnapshot = useCallback((params: AddSnapshotParams) => {
    const codeHash = simpleHash(params.code);

    setHistory((prev) => {
      // Deduplication: skip if codeHash matches last entry
      if (prev.length > 0 && prev[prev.length - 1].codeHash === codeHash) {
        return prev;
      }

      const runNumber = prev.length > 0 ? prev[prev.length - 1].runNumber + 1 : 1;

      // Build test results from params
      const testResults: TestSnapshotResult[] = params.testResults ?? [
        {
          testName: "shadow_run",
          passed: params.result.success,
          output: params.result.output,
          error: params.result.error,
        },
      ];

      const passCount = testResults.filter((t) => t.passed).length;
      const failCount = testResults.filter((t) => !t.passed).length;

      const snapshot: ExecutionSnapshot = {
        id: `run-${runNumber}-${Date.now()}`,
        timestamp: params.timestamp,
        runNumber,
        code: params.code,
        codeHash,
        results: testResults,
        success: failCount === 0 && testResults.length > 0,
        passCount,
        failCount,
        durationMs: params.durationMs ?? 0,
        terminated: params.terminated ?? false,
      };

      const next = [...prev, snapshot];
      // Cap at MAX_HISTORY
      if (next.length > MAX_HISTORY) {
        return next.slice(next.length - MAX_HISTORY);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
  }, []);

  const latest = useMemo(() => {
    return history.length > 0 ? history[history.length - 1] : null;
  }, [history]);

  const passRateOverTime = useMemo(() => {
    return history.map((snap) => {
      const total = snap.results.length;
      if (total === 0) return 0;
      return snap.passCount / total;
    });
  }, [history]);

  const regressionDetected = useMemo(() => {
    if (history.length < 2) return false;
    const prev = history[history.length - 2];
    const curr = history[history.length - 1];

    // Check if any test that was passing in prev is now failing in curr
    for (const prevTest of prev.results) {
      if (!prevTest.passed) continue;
      const currTest = curr.results.find((t) => t.testName === prevTest.testName);
      if (currTest && !currTest.passed) {
        return true;
      }
    }
    return false;
  }, [history]);

  return {
    history,
    latest,
    passRateOverTime,
    regressionDetected,
    addSnapshot,
    clear,
  };
}
