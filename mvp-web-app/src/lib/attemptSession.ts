/**
 * Attempt Session - Canonical per-project/problem session for metrics
 *
 * Plan: .cursor/plans/shared_instrumentation_and_metrics_506970d1.plan.md
 *
 * Session is the unit of "attempted work," not wall-clock time.
 * - Start: when user focuses project/problem and presence is confirmed (first diff tick or activity).
 * - End: submit, presence_timeout, page_leave, or inactivity.
 *
 * Integrates with inputDiffTracker for diff-based active_tick / idle_count and
 * drives session summary + artifact upload on end. Session Artifacts are the
 * canonical representation of user actions; profile narratives come from them.
 */

import {
  setOnDiffTick,
  getCurrentContentForContext,
  getSquashedDiffs,
} from "./inputDiffTracker";
import { logAction, getConnectionState, getLastKnownCode } from "./actionLogger";
import { fetchWithAuth } from "./fetchWithAuth";
import { isApiConfigured } from "./apiConfig";
import {
  enqueueSessionArtifact,
  drainSessionArtifacts,
  reEnqueueSessionArtifact,
} from "./sessionArtifactCache";
import type {
  AttemptSessionEndReason,
  SessionSummary,
  SessionArtifact,
  RunOutcome,
  VelocityMetrics,
  FirstAttemptMetrics,
  IterationMetrics,
  DebuggingMetrics,
  TestProgress,
  TestProgressPoint,
  TestCaseSolvedState,
  DiffHistoryEntry,
} from "./sessionSummary";
import {
  getDebuggingSignalsSnapshot,
  clearDebuggingSignals,
} from "./debuggingSignals";
import { updateSessionNarratives, generateUnifiedSessionNarrative } from "./profileNanoEditor";

// ============================================================================
// Session logging (building/marshaling, idle count, run outcomes, artifact flow)
// ============================================================================

const LOG_PREFIX = "[AttemptSession]";

function shouldLogSessionDebug(): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") return true;
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SESSION_DEBUG === "1") return true;
  if (typeof window !== "undefined") {
    if ((window as unknown as { __SESSION_DEBUG?: boolean }).__SESSION_DEBUG === true) return true;
    try {
      if (localStorage.getItem("SESSION_DEBUG") === "1") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function sessionLog(
  msg: string,
  data?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info"
): void {
  if (!shouldLogSessionDebug() && level === "info") return;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (data != null) fn(`${LOG_PREFIX} ${msg}`, data);
  else fn(`${LOG_PREFIX} ${msg}`);
}

const TICK_INTERVAL_SEC = 15;
const IDLE_TICKS_BEFORE_PRESENCE = 20;
const PRESENCE_TIMEOUT_MS = 10_000;

export type PresenceCheckHandler = (options: {
  onDismiss: () => void;
  onTimeout: () => void;
  timeoutMs: number;
}) => void;

interface AttemptSessionState {
  sessionId: string;
  projectId?: string;
  problemId?: string;
  startedAt: number;
  endedAt: number | null;
  endReason: AttemptSessionEndReason | null;
  activeTick: number;
  idleCount: number;
  runOutcomes: RunOutcome[];
  /** Captured on first diff tick; used at end for squashedDiffs. */
  initialContentByFile?: Record<string, string>;
  /** Content at end of previous run (or initial); used to compute per-run diff. */
  contentAtLastRun?: Record<string, string>;
  /** Per-run diffs: what changed from previous run (or initial) to current run. */
  diffHistory: DiffHistoryEntry[];
}

let state: AttemptSessionState | null = null;
let presenceCheckHandler: PresenceCheckHandler | null = null;
let presenceCheckScheduled = false;
let sessionConceptsFetched: string[] | null = null;

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function setPresenceCheckHandler(handler: PresenceCheckHandler | null): void {
  presenceCheckHandler = handler;
}

/**
 * Set concept IDs for the current session (e.g. from project.conceptsExpected).
 * Call from the project/problem page when you have concept metadata.
 */
export function setSessionConcepts(concepts: string[]): void {
  sessionConceptsFetched = concepts.length > 0 ? concepts : null;
  sessionLog("setSessionConcepts", {
    count: concepts.length,
    concepts: concepts.slice(0, 10),
    source: "project/problem page (e.g. conceptsExpected)",
  });
}

export function startAttemptSession(options: {
  projectId?: string;
  problemId?: string;
}): void {
  if (state && !state.endedAt) {
    sessionLog("startAttemptSession skipped (already in session)", {
      existingSessionId: state.sessionId,
      projectId: state.projectId,
      problemId: state.problemId,
    });
    return; // already in a session
  }
  const sessionId = generateSessionId();
  state = {
    sessionId,
    projectId: options.projectId,
    problemId: options.problemId,
    startedAt: Date.now(),
    endedAt: null,
    endReason: null,
    activeTick: 0,
    idleCount: 0,
    runOutcomes: [],
    diffHistory: [],
  };
  sessionLog("startAttemptSession", {
    sessionId,
    projectId: options.projectId,
    problemId: options.problemId,
    startedAt: state.startedAt,
    source: "AttemptSessionProvider / project or problem panel mount",
  });
  logAction({
    type: "attempt_session_start",
    timestamp: Date.now(),
    metadata: {
      sessionId,
      projectId: options.projectId,
      problemId: options.problemId,
      startedAt: state.startedAt,
    },
  });
  // Wire diff tick callback if not already
  setOnDiffTick(handleDiffTick);
}

function handleDiffTick(diffChanged: boolean): void {
  if (!state || state.endedAt !== null) return;

  const key = state.projectId || state.problemId;
  if (diffChanged) {
    if (key && state.initialContentByFile === undefined) {
      const initial = getCurrentContentForContext(key);
      if (initial && Object.keys(initial).length > 0) {
        state.initialContentByFile = initial;
        sessionLog("initial content captured for squashedDiffs", {
          sessionId: state.sessionId,
          fileCount: Object.keys(initial).length,
        });
      }
    }
    state.activeTick += 1;
    state.idleCount = 0;
    presenceCheckScheduled = false;
    sessionLog("diff tick (active)", {
      sessionId: state.sessionId,
      activeTick: state.activeTick,
      idleCount: state.idleCount,
      activeSeconds: state.activeTick * TICK_INTERVAL_SEC,
      source: "inputDiffTracker 15s tick, content changed",
    });
  } else {
    state.idleCount += 1;
    sessionLog("diff tick (idle)", {
      sessionId: state.sessionId,
      activeTick: state.activeTick,
      idleCount: state.idleCount,
      idleSeconds: state.idleCount * TICK_INTERVAL_SEC,
      source: "inputDiffTracker 15s tick, no change",
    });
    if (
      state.idleCount > 0 &&
      state.idleCount % IDLE_TICKS_BEFORE_PRESENCE === 0 &&
      !presenceCheckScheduled
    ) {
      presenceCheckScheduled = true;
      sessionLog("presence check scheduled", {
        sessionId: state.sessionId,
        idleCount: state.idleCount,
        idleTicksBeforePresence: IDLE_TICKS_BEFORE_PRESENCE,
      });
      triggerPresenceCheck();
    }
  }
}

function triggerPresenceCheck(): void {
  const onTimeout = (): void => {
    presenceCheckScheduled = false;
    endAttemptSession("presence_timeout");
  };
  const onDismiss = (): void => {
    presenceCheckScheduled = false;
    // User confirmed still here; optionally reset idle for next cycle (keep counting for now)
  };
  if (presenceCheckHandler) {
    presenceCheckHandler({
      onDismiss,
      onTimeout,
      timeoutMs: PRESENCE_TIMEOUT_MS,
    });
  } else {
    // No UI handler registered; end session on "timeout" after delay
    setTimeout(onTimeout, PRESENCE_TIMEOUT_MS);
  }
}

export function getSessionState(): {
  sessionId: string;
  projectId?: string;
  problemId?: string;
  startedAt: number;
  activeTick: number;
  idleCount: number;
  activeSeconds: number;
  idleSeconds: number;
  engagedRatio: number;
  runOutcomes: RunOutcome[];
} | null {
  if (!state || state.endedAt !== null) return null;
  const total = state.activeTick * TICK_INTERVAL_SEC + state.idleCount * TICK_INTERVAL_SEC;
  const activeSeconds = state.activeTick * TICK_INTERVAL_SEC;
  const idleSeconds = state.idleCount * TICK_INTERVAL_SEC;
  const engagedRatio = total > 0 ? Math.min(1, Math.max(0, activeSeconds / total)) : 0;
  return {
    sessionId: state.sessionId,
    projectId: state.projectId,
    problemId: state.problemId,
    startedAt: state.startedAt,
    activeTick: state.activeTick,
    idleCount: state.idleCount,
    activeSeconds,
    idleSeconds,
    engagedRatio,
    runOutcomes: [...state.runOutcomes],
  };
}

export function recordRunOutcome(outcome: RunOutcome): void {
  if (!state || state.endedAt !== null) return;
  const key = state.projectId || state.problemId;
  const currentContent = key ? getCurrentContentForContext(key) : null;
  const runIndex = state.runOutcomes.length + 1;
  const prevContent = state.contentAtLastRun ?? state.initialContentByFile;
  if (
    key &&
    prevContent &&
    Object.keys(prevContent).length > 0 &&
    currentContent &&
    Object.keys(currentContent).length > 0
  ) {
    const diffs = getSquashedDiffs(prevContent, currentContent);
    if (Object.keys(diffs).length > 0) {
      state.diffHistory.push({
        runIndex,
        timestamp: Date.now(),
        diffs,
      });
      sessionLog("diffHistory appended", {
        sessionId: state.sessionId,
        runIndex,
        fileCount: Object.keys(diffs).length,
      });
    }
  }
  if (currentContent && Object.keys(currentContent).length > 0) {
    state.contentAtLastRun = { ...currentContent };
  }
  state.runOutcomes.push(outcome);
  sessionLog("recordRunOutcome", {
    sessionId: state.sessionId,
    runIndex: state.runOutcomes.length,
    activeSecondsAtRun: outcome.activeSecondsAtRun,
    passed: outcome.passed,
    testsPassed: outcome.testsPassed,
    testsTotal: outcome.testsTotal,
    compileSuccess: outcome.compileSuccess,
    firstRunInSession: outcome.firstRunInSession,
    source: "recordRunAndLog from ProjectTestResultsPanel / TestResultsPanel",
  });
}

const SESSION_ARTIFACT_FLUSH_INTERVAL_MS = 90 * 1000;

let sessionArtifactFlushTimer: ReturnType<typeof setInterval> | null = null;

/** Resolved when the current endAttemptSession has finished enqueueing (so flush can safely drain). */
let pendingEnqueueResolve: (() => void) | null = null;
let pendingEnqueuePromise: Promise<void> | null = null;

/**
 * Wait for any in-flight endAttemptSession to finish enqueueing its artifact.
 * Call before draining session artifacts so visibility-hidden flush doesn't race with submit.
 */
export function awaitPendingSessionEnqueue(): Promise<void> {
  return pendingEnqueuePromise ?? Promise.resolve();
}

export async function endAttemptSession(reason: AttemptSessionEndReason): Promise<void> {
  if (!state) return;
  if (state.endedAt !== null) return; // already ended
  pendingEnqueuePromise = new Promise<void>((r) => {
    pendingEnqueueResolve = r;
  });
  state.endedAt = Date.now();
  state.endReason = reason;

  sessionLog("endAttemptSession started", {
    sessionId: state.sessionId,
    projectId: state.projectId,
    problemId: state.problemId,
    endReason: reason,
    activeTick: state.activeTick,
    idleCount: state.idleCount,
    runOutcomesCount: state.runOutcomes.length,
    source: "submit / presence_timeout / page_leave",
  });

  const summary = buildSessionSummary();
  sessionLog("buildSessionSummary done", {
    sessionId: summary.sessionId,
    activeSeconds: summary.activeSeconds,
    idleSeconds: summary.idleSeconds,
    engagedRatio: summary.engagedRatio,
    runCount: summary.runCount,
    hasVelocity: !!summary.velocity,
    hasFirstAttempt: !!summary.firstAttempt,
    hasIteration: !!summary.iteration,
    hasDebugging: !!summary.debugging,
    conceptsCount: summary.conceptsFetched?.length ?? 0,
  });

  const key = state.projectId || state.problemId;
  const finalCodeFromLogger = key ? getLastKnownCode(key) : null;
  const currentContent = key ? getCurrentContentForContext(key) : null;
  const finalCode =
    (finalCodeFromLogger && Object.keys(finalCodeFromLogger).length > 0)
      ? finalCodeFromLogger
      : (currentContent && Object.keys(currentContent).length > 0)
        ? currentContent
        : null;
  const finalCodeKeys = finalCode ? Object.keys(finalCode) : [];

  let squashedDiffs: Record<string, string> | undefined;
  const initialContentByFile = state.initialContentByFile && Object.keys(state.initialContentByFile).length > 0
    ? state.initialContentByFile
    : undefined;
  if (key && initialContentByFile && currentContent && Object.keys(currentContent).length > 0) {
    squashedDiffs = getSquashedDiffs(initialContentByFile, currentContent);
    if (Object.keys(squashedDiffs).length === 0) squashedDiffs = undefined;
  }

  sessionLog("artifact finalCode source", {
    sessionId: state.sessionId,
    key,
    finalCodeKeyCount: finalCodeKeys.length,
    finalCodeKeys,
    source: finalCodeFromLogger && Object.keys(finalCodeFromLogger).length > 0 ? "actionLogger" : "inputDiffTracker",
    squashedDiffsFileCount: squashedDiffs ? Object.keys(squashedDiffs).length : 0,
    startingCodeFileCount: initialContentByFile ? Object.keys(initialContentByFile).length : 0,
  });

  const testLogs = state.runOutcomes.map((r) => ({
    passed: r.passed,
    testsPassed: r.testsPassed,
    testsTotal: r.testsTotal,
    compileSuccess: r.compileSuccess,
    errorSnippet: r.errorSnippet,
  }));
  const artifact: SessionArtifact = {
    summary,
    ...(initialContentByFile && { startingCode: initialContentByFile }),
    ...(finalCode && finalCodeKeys.length > 0 && { finalCode }),
    ...(squashedDiffs && Object.keys(squashedDiffs).length > 0 && { squashedDiffs }),
    testLogs: testLogs.length > 0 ? testLogs : undefined,
    ...(summary.testProgress && { testProgress: summary.testProgress }),
    ...(summary.testCases && summary.testCases.length > 0 && { testCases: summary.testCases }),
    ...(summary.diffHistory && summary.diffHistory.length > 0 && { diffHistory: summary.diffHistory }),
  };
  sessionLog("artifact marshaled", {
    sessionId: artifact.summary.sessionId,
    summaryKeys: Object.keys(artifact.summary),
    hasStartingCode: !!artifact.startingCode && Object.keys(artifact.startingCode).length > 0,
    startingCodeFileCount: artifact.startingCode ? Object.keys(artifact.startingCode).length : 0,
    hasFinalCode: !!artifact.finalCode && Object.keys(artifact.finalCode).length > 0,
    finalCodeFileCount: artifact.finalCode ? Object.keys(artifact.finalCode).length : 0,
    hasSquashedDiffs: !!artifact.squashedDiffs && Object.keys(artifact.squashedDiffs).length > 0,
    testLogsCount: artifact.testLogs?.length ?? 0,
  });

  const narrative = await generateUnifiedSessionNarrative(artifact).catch(() => null);
  if (narrative) {
    artifact.summary.narratives = { narrative };
    sessionLog("session narratives", {
      sessionId: artifact.summary.sessionId,
      hasNarrative: true,
      length: narrative.length,
    });
  }

  logAction({
    type: "attempt_session_end",
    timestamp: state.endedAt,
    metadata: {
      sessionId: state.sessionId,
      projectId: state.projectId,
      problemId: state.problemId,
      endReason: reason,
      activeSeconds: summary.activeSeconds,
      runCount: summary.runCount,
      hasNarratives: !!artifact.summary.narratives?.narrative,
    },
  });

  try {
    await enqueueSessionArtifact(artifact);
  } catch (err) {
    sessionLog("Enqueue failed", { sessionId: state?.sessionId, err }, "warn");
  } finally {
    if (pendingEnqueueResolve) {
      pendingEnqueueResolve();
      pendingEnqueueResolve = null;
    }
    pendingEnqueuePromise = null;
  }

  updateSessionNarratives(summary).catch(() => {});

  sessionConceptsFetched = null;
  setOnDiffTick(null);
  state = null;
}

function buildSessionSummary(): SessionSummary {
  if (!state) throw new Error("No session state");
  const total =
    state.activeTick * TICK_INTERVAL_SEC + state.idleCount * TICK_INTERVAL_SEC;
  const activeSeconds = state.activeTick * TICK_INTERVAL_SEC;
  const idleSeconds = state.idleCount * TICK_INTERVAL_SEC;
  const engagedRatio = total > 0 ? Math.min(1, Math.max(0, activeSeconds / total)) : 0;

  sessionLog("buildSessionSummary inputs", {
    sessionId: state.sessionId,
    activeTick: state.activeTick,
    idleCount: state.idleCount,
    runOutcomesCount: state.runOutcomes.length,
    conceptsCount: sessionConceptsFetched?.length ?? 0,
  });

  const velocity = computeVelocityMetrics(state.runOutcomes);
  const firstAttempt = computeFirstAttemptMetrics(state.runOutcomes);
  const iteration = computeIterationMetrics(state.runOutcomes);
  const debugging = computeDebuggingMetrics(state.runOutcomes);
  const testProgress = computeTestProgress(state.runOutcomes);
  const testCases = computeTestCaseSolvedStates(state.runOutcomes);

  return {
    sessionId: state.sessionId,
    projectId: state.projectId,
    problemId: state.problemId,
    startedAt: state.startedAt,
    endedAt: state.endedAt!,
    endReason: state.endReason!,
    activeSeconds,
    idleSeconds,
    engagedRatio,
    runCount: state.runOutcomes.length,
    runOutcomes: [...state.runOutcomes],
    helpEventsCount: 0,
    velocity,
    firstAttempt,
    iteration,
    debugging,
    conceptsFetched: sessionConceptsFetched ?? undefined,
    ...(testProgress && { testProgress }),
    ...(testCases && testCases.length > 0 && { testCases }),
    ...(state.diffHistory.length > 0 && { diffHistory: [...state.diffHistory] }),
  };
}

/**
 * Compute line-plot data from run outcomes. One point per run.
 * Solved = passed on a run; becomes unsolved if it fails on a later run.
 * Runs without testCases keep the previous solved count (e.g. compile failure).
 */
function computeTestProgress(runs: RunOutcome[]): TestProgress | undefined {
  const hasAnyCases = runs.some((r) => r.testCases && r.testCases.length > 0);
  if (!hasAnyCases) return undefined;
  const solved = new Set<string>();
  const points: TestProgressPoint[] = [];
  const allIds = new Set<string>();
  let lastSolvedCount = 0;
  runs.forEach((run, idx) => {
    if (run.testCases && run.testCases.length > 0) {
      run.testCases.forEach((tc) => {
        allIds.add(tc.id);
        if (tc.passed) solved.add(tc.id);
        else solved.delete(tc.id);
      });
      lastSolvedCount = solved.size;
    }
    points.push({ runIndex: idx + 1, solvedCount: lastSolvedCount });
  });
  return { points, testCaseCount: allIds.size };
}

/**
 * Per-test-case solved state at session end: solved = passed on the last run it appeared in.
 * firstPassedRun / lastFailedRun are 1-based run indices.
 */
function computeTestCaseSolvedStates(runs: RunOutcome[]): TestCaseSolvedState[] | undefined {
  const withCases = runs.filter((r) => r.testCases && r.testCases.length > 0);
  if (withCases.length === 0) return undefined;
  const byId = new Map<string, { name: string; firstPassedRun?: number; lastFailedRun?: number; lastRunPassed?: boolean }>();
  withCases.forEach((run, idx) => {
    const runIndex = idx + 1;
    run.testCases!.forEach((tc) => {
      const existing = byId.get(tc.id);
      if (!existing) byId.set(tc.id, { name: tc.name });
      const rec = byId.get(tc.id)!;
      if (tc.passed) rec.firstPassedRun = rec.firstPassedRun ?? runIndex;
      else rec.lastFailedRun = runIndex;
      rec.lastRunPassed = tc.passed;
    });
  });
  return Array.from(byId.entries()).map(([id, rec]) => ({
    id,
    name: rec.name,
    solved: rec.lastRunPassed === true,
    firstPassedRun: rec.firstPassedRun,
    lastFailedRun: rec.lastFailedRun,
  }));
}

function computeDebuggingMetrics(runs: RunOutcome[]): DebuggingMetrics | undefined {
  const signals = getDebuggingSignalsSnapshot();
  const rerunCount = signals.filter((s) => s.type === "rerun_same_test").length;
  clearDebuggingSignals();

  const runCount = runs.length;
  // Placeholder: editToRunRatio omitted from LLM compact payload until derived from real edit events
  const editToRunRatio = runCount > 0 ? 1 : 0;
  return {
    diagnosisLatencySec: 0,
    editToRunRatio,
    localizationScore: 0,
    hypothesisTestCycles: rerunCount,
  };
}

function computeVelocityMetrics(runs: RunOutcome[]): VelocityMetrics | undefined {
  if (runs.length === 0) return undefined;
  const firstPass = runs.find(
    (r) => r.passed && r.testsTotal != null && r.testsTotal > 0 && r.testsPassed === r.testsTotal
  );
  return {
    activeSecondsToPass: firstPass?.activeSecondsAtRun,
    attemptCount: runs.length,
    potentialCopyEvent: false,
  };
}

function computeFirstAttemptMetrics(runs: RunOutcome[]): FirstAttemptMetrics | undefined {
  if (runs.length === 0) return undefined;
  const first = runs[0];
  const k = 3;
  const firstK = runs.slice(0, k);
  const firstKRunsErrorCount = firstK.filter(
    (r) => !r.compileSuccess || !r.passed
  ).length;
  const testPassFraction =
    first.testsTotal != null && first.testsTotal > 0
      ? (first.testsPassed ?? 0) / first.testsTotal
      : 0;
  return {
    firstRunCompileSuccess: first.compileSuccess ?? true,
    firstRunTestPassFraction: testPassFraction,
    firstKRunsErrorCount,
    timeToFirstRunSec: first.activeSecondsAtRun,
  };
}

/** Minimum cumulative testsTotal in a window so improvement is measured over meaningful test volume. */
const ITERATION_WINDOW_MIN_CUMULATIVE_TESTS = 5;

/**
 * For run index i, get the start index j of the window ending at i such that
 * cumulative testsTotal over runs[j..i] is at least minCumulative (or j=0 if not enough).
 */
function iterationWindowStart(
  runs: RunOutcome[],
  endIndex: number,
  minCumulative: number
): number {
  let cum = 0;
  for (let j = endIndex; j >= 0; j--) {
    const total = runs[j].testsTotal ?? 0;
    cum += total;
    if (cum >= minCumulative) return j;
  }
  return 0;
}

function computeIterationMetrics(runs: RunOutcome[]): IterationMetrics | undefined {
  if (runs.length === 0) return undefined;
  const passIndex = runs.findIndex(
    (r) => r.passed && r.testsTotal != null && r.testsTotal > 0 && r.testsPassed === r.testsTotal
  );
  const iterationsToPass = passIndex >= 0 ? passIndex + 1 : runs.length;

  // Use failure rate (failed/total) per run so growth in test suite size shows as learning.
  const failedRates = runs.map((r) => {
    const total = r.testsTotal ?? 0;
    const failed = total > 0 ? total - (r.testsPassed ?? 0) : 0;
    return total > 0 ? failed / total : 0;
  });

  // Moving average of failure rate: window size based on cumulative testsTotal in the window.
  // This makes improvement robust to changing test suite size (e.g. 1 test then 5 tests).
  const minCumulative = Math.max(1, ITERATION_WINDOW_MIN_CUMULATIVE_TESTS);
  const smoothed: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const j = iterationWindowStart(runs, i, minCumulative);
    let sum = 0;
    let count = 0;
    for (let k = j; k <= i; k++) {
      sum += failedRates[k];
      count += 1;
    }
    smoothed.push(count > 0 ? sum / count : 0);
  }

  let progressSum = 0;
  let progressCount = 0;
  let regressions = 0;
  let noImprovement = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const delta = smoothed[i - 1] - smoothed[i];
    progressSum += delta;
    progressCount += 1;
    if (delta < 0) regressions += 1;
    else if (delta === 0 && smoothed[i] > 0) noImprovement += 1;
  }
  const progressPerIteration =
    progressCount > 0 ? progressSum / progressCount : 0;
  const thrashScore = progressCount > 0 ? (regressions + noImprovement) / progressCount : 0;
  // Linear regression of smoothed failed counts vs index (negative slope = improving)
  let convergenceRate = 0;
  if (smoothed.length >= 2) {
    const n = smoothed.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += smoothed[i];
      sumXY += i * smoothed[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    convergenceRate = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  }
  const classification: "convergent" | "thrashing" =
    thrashScore > 0.5 ? "thrashing" : "convergent";

  return {
    iterationsToPass,
    progressPerIteration,
    thrashScore,
    convergenceRate,
    classification,
  };
}

export async function uploadSessionArtifact(artifact: SessionArtifact): Promise<void> {
  if (!isApiConfigured()) return;
  const response = await fetchWithAuth("/telemetry/session-artifact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(artifact),
  });
  if (!response.ok) {
    throw new Error(`Session artifact upload failed: ${response.status}`);
  }
}

/**
 * Flush all queued session artifacts to the backend sequentially.
 * Only uploads when connection is online; skips when offline/degraded.
 */
export async function flushSessionArtifacts(): Promise<void> {
  const conn = getConnectionState();
  if (conn !== "online" || !isApiConfigured()) {
    sessionLog("flushSessionArtifacts skipped", { connectionState: conn, apiConfigured: isApiConfigured() });
    return;
  }
  await awaitPendingSessionEnqueue();
  const artifacts = await drainSessionArtifacts();
  sessionLog("flushSessionArtifacts drain", {
    artifactCount: artifacts.length,
    sessionIds: artifacts.map((a) => a.summary.sessionId),
    source: "drainSessionArtifacts (memory + IndexedDB)",
  });
  if (artifacts.length === 0) return;
  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    try {
      sessionLog("uploading session artifact", {
        index: i + 1,
        total: artifacts.length,
        sessionId: artifact.summary.sessionId,
      });
      await uploadSessionArtifact(artifact);
      sessionLog("session artifact uploaded", {
        sessionId: artifact.summary.sessionId,
      });
    } catch (err) {
      sessionLog("Session artifact upload failed, re-queuing", { sessionId: artifact.summary.sessionId, err }, "warn");
      void reEnqueueSessionArtifact(artifact);
      break;
    }
  }
}

/**
 * Start the scheduler that flushes queued session artifacts at the same
 * interval as the action logger (90s), when health is passing.
 * Call once from app init (e.g. ActionTrackingProvider).
 */
export function startSessionArtifactScheduler(): void {
  if (sessionArtifactFlushTimer != null) {
    sessionLog("startSessionArtifactScheduler skipped (already running)");
    return;
  }
  sessionArtifactFlushTimer = setInterval(
    () => void flushSessionArtifacts(),
    SESSION_ARTIFACT_FLUSH_INTERVAL_MS
  );
  sessionLog("startSessionArtifactScheduler", {
    intervalMs: SESSION_ARTIFACT_FLUSH_INTERVAL_MS,
    source: "ActionTrackingProvider init",
  });
}

/**
 * Force flush session artifacts now (e.g. on visibility hidden or beforeunload).
 */
export function forceFlushSessionArtifacts(): void {
  sessionLog("forceFlushSessionArtifacts", { source: "visibility hidden / beforeunload" });
  void flushSessionArtifacts();
}

export function cleanupAttemptSession(): void {
  sessionLog("cleanupAttemptSession", {
    hadActiveSession: !!(state && state.endedAt === null),
    sessionId: state?.sessionId,
    source: "panel unmount / page leave",
  });
  if (state && state.endedAt === null) {
    endAttemptSession("page_leave");
  }
  setOnDiffTick(null);
  presenceCheckHandler = null;
  presenceCheckScheduled = false;
}
