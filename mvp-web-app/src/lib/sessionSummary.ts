/**
 * Session summary and artifact types for the shared instrumentation layer.
 * Used when an attempt session ends to upload metrics and artifacts.
 */

export type AttemptSessionEndReason =
  | "submit"
  | "presence_timeout"
  | "page_leave"
  | "inactivity";

/** Per-test-case result for one run (stable id = test name for matching across runs). */
export interface RunOutcomeTestCase {
  id: string;
  name: string;
  passed: boolean;
}

/** Run outcome for a single run/test/submit event in the session */
export interface RunOutcome {
  timestamp: number;
  activeSecondsAtRun: number;
  passed: boolean;
  testsPassed?: number;
  testsTotal?: number;
  compileSuccess?: boolean;
  errorSnippet?: string;
  firstRunInSession?: boolean;
  /** Per-test-case pass/fail for this run; used to compute solved state and test progress line. */
  testCases?: RunOutcomeTestCase[];
}

/** Metadata attached to run_code_click / run_test_case_click / submit_click events for metrics */
export interface RunResultMetadata {
  passed: boolean;
  testsPassed?: number;
  testsTotal?: number;
  compileSuccess?: boolean;
  errorSnippet?: string;
  firstRunInSession?: boolean;
}

/** First-attempt correctness metrics (first k runs in session) */
export interface FirstAttemptMetrics {
  firstRunCompileSuccess: boolean;
  firstRunTestPassFraction: number;
  firstKRunsErrorCount: number;
  timeToFirstRunSec: number;
}

/** Iteration efficiency metrics */
export interface IterationMetrics {
  iterationsToPass: number;
  /**
   * Average change in smoothed failure rate per step (moving-average windows by cumulative testsTotal).
   * Positive = failure rate decreasing over time (improving); negative = increasing (regressing/thrashing).
   */
  progressPerIteration: number;
  thrashScore: number;
  convergenceRate: number;
  classification: "convergent" | "thrashing";
}

/** Debugging intelligence metrics */
export interface DebuggingMetrics {
  diagnosisLatencySec: number;
  editToRunRatio: number;
  localizationScore: number;
  hypothesisTestCycles: number;
}

/** Velocity metrics (active-time normalized) */
export interface VelocityMetrics {
  activeSecondsToPass?: number;
  activeSecondsToFirstProgress?: number;
  attemptCount?: number;
  potentialCopyEvent?: boolean;
}

/** One point on the test-progress line plot: after this run, how many test cases are solved. */
export interface TestProgressPoint {
  runIndex: number;
  solvedCount: number;
}

/** Line-plot data: solved test count after each run (solved = passed and not failed again later). */
export interface TestProgress {
  points: TestProgressPoint[];
  testCaseCount: number;
}

/** Final solved state of a test case in the session (for artifact). */
export interface TestCaseSolvedState {
  id: string;
  name: string;
  solved: boolean;
  firstPassedRun?: number;
  lastFailedRun?: number;
}

/** One entry in the per-run diff history: diff from previous run (or initial) to content after this run. */
export interface DiffHistoryEntry {
  runIndex: number;
  timestamp: number;
  diffs: Record<string, string>;
}

/** LLM-generated session narrative: one multi-tier bullet list (from full artifact). */
export interface SessionNarratives {
  /** Multi-tier bullet list covering velocity, first attempt, iteration, transfer, debugging, test progress. */
  narrative?: string;
}

export interface SessionSummary {
  sessionId: string;
  projectId?: string;
  problemId?: string;
  startedAt: number;
  endedAt: number;
  endReason: AttemptSessionEndReason;
  activeSeconds: number;
  idleSeconds: number;
  engagedRatio: number;
  runCount: number;
  runOutcomes: RunOutcome[];
  helpEventsCount?: number;
  velocity?: VelocityMetrics;
  firstAttempt?: FirstAttemptMetrics;
  iteration?: IterationMetrics;
  debugging?: DebuggingMetrics;
  conceptsFetched?: string[];
  /** LLM-generated unified narrative (multi-tier bullet list); included in artifact upload */
  narratives?: SessionNarratives;
  /** Line-plot data: solved test count per run; present when runOutcomes include testCases. */
  testProgress?: TestProgress;
  /** Per-test-case solved state at session end; present when runOutcomes include testCases. */
  testCases?: TestCaseSolvedState[];
  /** Per-run diff history: what changed between runs (or from initial to first run). */
  diffHistory?: DiffHistoryEntry[];
}

export interface SessionArtifact {
  summary: SessionSummary;
  /** Code at session start (file path -> content). */
  startingCode?: Record<string, string>;
  squashedDiffs?: Record<string, string>;
  finalCode?: Record<string, string>;
  testLogs?: unknown[];
  /** Same as summary.testProgress; duplicated for narrative/UI (line-plot data). */
  testProgress?: TestProgress;
  /** Same as summary.testCases; per-test solved state for artifact. */
  testCases?: TestCaseSolvedState[];
  /** Per-run diff history for session story / code evolution narrative. */
  diffHistory?: DiffHistoryEntry[];
}
