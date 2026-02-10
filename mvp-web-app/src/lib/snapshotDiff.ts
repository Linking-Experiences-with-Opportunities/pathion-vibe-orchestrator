import { ExecutionSnapshot } from "@/hooks/useExecutionHistory";

/**
 * Diff result for a single test between two consecutive snapshots.
 */
export interface TestDiff {
  testName: string;
  previousOutput: unknown;
  currentOutput: unknown;
  changed: boolean;
  /** Was passing in previous run, now failing */
  regression: boolean;
  /** Was failing in previous run, now passing */
  fixed: boolean;
}

/**
 * A regression entry identifying when and where a regression occurred.
 */
export interface RegressionEntry {
  testName: string;
  regressedAtRun: number;
}

/**
 * Compare each test's output between two consecutive runs.
 * If prev is null, all tests are treated as new (no changes/regressions).
 */
export function diffSnapshots(
  prev: ExecutionSnapshot | null,
  curr: ExecutionSnapshot
): TestDiff[] {
  return curr.results.map((currTest) => {
    const prevTest = prev?.results.find((t) => t.testName === currTest.testName);

    if (!prevTest) {
      // New test (no previous result to compare against)
      return {
        testName: currTest.testName,
        previousOutput: undefined,
        currentOutput: currTest.output,
        changed: false,
        regression: false,
        fixed: false,
      };
    }

    const outputChanged = !deepEqual(prevTest.output, currTest.output);
    const wasPassingNowFailing = prevTest.passed && !currTest.passed;
    const wasFailingNowPassing = !prevTest.passed && currTest.passed;

    return {
      testName: currTest.testName,
      previousOutput: prevTest.output,
      currentOutput: currTest.output,
      changed: outputChanged,
      regression: wasPassingNowFailing,
      fixed: wasFailingNowPassing,
    };
  });
}

/**
 * Compute pass rate for each snapshot in the history.
 * Returns an array of numbers between 0 and 1.
 */
export function computePassRate(history: ExecutionSnapshot[]): number[] {
  return history.map((snap) => {
    const total = snap.results.length;
    if (total === 0) return 0;
    return snap.passCount / total;
  });
}

/**
 * Detect all regressions across the full history.
 * A regression is when a test was passing in run N and fails in run N+1.
 * Returns the first occurrence of each regression.
 */
export function detectRegressions(
  history: ExecutionSnapshot[]
): RegressionEntry[] {
  const regressions: RegressionEntry[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];

    for (const prevTest of prev.results) {
      if (!prevTest.passed) continue;
      const currTest = curr.results.find((t) => t.testName === prevTest.testName);
      if (currTest && !currTest.passed && !seen.has(currTest.testName)) {
        regressions.push({
          testName: currTest.testName,
          regressedAtRun: curr.runNumber,
        });
        seen.add(currTest.testName);
      }
    }
  }

  return regressions;
}

/**
 * Simple deep equality check for comparing test outputs.
 * Handles primitives, arrays, and plain objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => deepEqual(val, b[idx]));
    }

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
