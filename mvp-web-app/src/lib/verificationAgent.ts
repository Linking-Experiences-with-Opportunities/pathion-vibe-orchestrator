/**
 * verificationAgent.ts
 *
 * Types and placeholder metric computation for the Verification Agent pipeline.
 * The agent monitors user "thrashing" (rapid consecutive failures) and triggers
 * Gemini 3 Pro to generate Cognitive Mirror artifacts when the thrash_score
 * exceeds a threshold.
 *
 * Placeholder metrics will be replaced once David's instrumentation layer lands.
 */

// ---------------------------------------------------------------------------
// 1. Core Types
// ---------------------------------------------------------------------------

/** Session-level metrics extracted from the instrumentation layer. */
export interface SessionSummary {
  /** (Consecutive Failures) / (Avg Seconds Between Runs). Higher = more thrashing. */
  thrash_score: number;
  /** Ratio of tests-passing over total runs in the session window (0..1). */
  convergence_rate: number;
  /** Elapsed seconds from first event in window to first all-pass (Infinity if never). */
  active_seconds_to_pass: number;
}

/** David's session summary payload (camelCase). */
export interface DavidSessionSummaryPayload {
  summary?: {
    runCount?: number;
    iteration?: {
      thrashScore?: number;
      convergenceRate?: number;
      activeSecondsToPass?: number; // ask David to add
      classification?: string;
      iterationsToPass?: number;
      progressPerIteration?: number;
    };
    narratives?: Record<string, string>;
    endReason?: string;
  };
}

/** AI-generated Report Card from the Verification Agent. */
export interface ReportCard {
  /** Root cause diagnosis of the user's structural failure. */
  diagnosis: string;
  /** Description of the mental model gap the user appears to have. */
  mentalModelGap: string;
  /** A Python assertion string that will FAIL given the user's current logic. */
  verificationChallenge: string;
}

/** One frame of the "Cognitive Shadow" — what the AI thinks vs. what WASM shows. */
export interface CognitiveShadowFrame {
  /** What the AI believes the user is currently assuming. */
  userAssumption: string;
  /** What the Pyodide/WASM execution state actually shows. */
  wasmReality: string;
  /** The delta / mismatch explanation. */
  delta: string;
}

/** Full response from the /api/verification-agent route. */
export interface VerificationAgentResponse {
  reportCard: ReportCard;
  cognitiveShadow: CognitiveShadowFrame[];
}

// ---------------------------------------------------------------------------
// 2. Event History Shape (lightweight, used for metric computation)
// ---------------------------------------------------------------------------

/** A single entry in the rolling event history tracked by the hook. */
export interface RunEvent {
  /** Timestamp of the run (Date.now()). */
  timestamp: number;
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Total tests. */
  total: number;
}

// ---------------------------------------------------------------------------
// 3. Threshold
// ---------------------------------------------------------------------------

/**
 * When thrash_score exceeds this value, the Verification Agent triggers.
 * Formula: (consecutive failures) / (avg seconds between runs).
 * A score of 3.0 means e.g. 6 consecutive failures at 2s average spacing.
 */
export const THRASH_THRESHOLD = 3.0;

/**
 * Minimum cooldown (ms) between agent triggers to avoid spamming the API.
 */
export const AGENT_COOLDOWN_MS = 15_000;

// ---------------------------------------------------------------------------
// 4. Placeholder Metric Computation
// ---------------------------------------------------------------------------

/**
 * Compute placeholder session metrics from a rolling window of RunEvents.
 *
 * - `thrash_score`: (consecutive trailing failures) / (avg seconds between runs)
 * - `convergence_rate`: (runs where passed > 0) / (total runs)
 * - `active_seconds_to_pass`: seconds from first event to first all-pass, or Infinity
 *
 * These will be replaced by David's instrumentation layer once it lands.
 */
export function computePlaceholderMetrics(events: RunEvent[]): SessionSummary {
  // [verification-agent] Step 1a: computePlaceholderMetrics — input (David's event stream will feed here)
  console.log("[verification-agent] Step 1a: computePlaceholderMetrics — input", {
    eventCount: events.length,
    lastEvents: events.slice(-3).map((e) => ({ ts: e.timestamp, passed: e.passed, failed: e.failed, total: e.total })),
  });

  if (events.length === 0) {
    const out = { thrash_score: 0, convergence_rate: 0, active_seconds_to_pass: Infinity };
    console.log("[verification-agent] Step 1b: computePlaceholderMetrics — output (empty)", out);
    return out;
  }

  // --- Consecutive trailing failures ---
  let consecutiveFailures = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].failed > 0) {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  // --- Average seconds between runs ---
  let avgSecondsBetweenRuns = 1; // fallback to 1s to avoid division by zero
  if (events.length >= 2) {
    const totalSpanMs = events[events.length - 1].timestamp - events[0].timestamp;
    avgSecondsBetweenRuns = Math.max(
      0.5,
      totalSpanMs / 1000 / (events.length - 1)
    );
  }

  const thrash_score = consecutiveFailures / avgSecondsBetweenRuns;

  // --- Convergence rate ---
  const runsWithProgress = events.filter((e) => e.passed > 0).length;
  const convergence_rate = runsWithProgress / events.length;

  // --- Active seconds to first all-pass ---
  const firstEvent = events[0];
  const firstAllPass = events.find((e) => e.passed === e.total && e.total > 0);
  const active_seconds_to_pass = firstAllPass
    ? (firstAllPass.timestamp - firstEvent.timestamp) / 1000
    : Infinity;

  const out: SessionSummary = { thrash_score, convergence_rate, active_seconds_to_pass };
  // [verification-agent] Step 1b: computePlaceholderMetrics — output (SessionSummary David will eventually send)
  console.log("[verification-agent] Step 1b: computePlaceholderMetrics — output", {
    thrash_score: out.thrash_score.toFixed(2),
    convergence_rate: out.convergence_rate.toFixed(2),
    active_seconds_to_pass: out.active_seconds_to_pass === Infinity ? "Infinity" : `${out.active_seconds_to_pass.toFixed(1)}s`,
    consecutiveFailures,
  });
  return out;
}

/**
 * Maps David's session summary payload to our internal SessionSummary.
 * Returns null if the payload is missing/invalid, so the hook can fall back to placeholder metrics.
 */
export function mapDavidSummaryToSessionSummary(
  payload: DavidSessionSummaryPayload | null | undefined
): SessionSummary | null {
  if (!payload?.summary?.iteration) {
    return null;
  }

  const { thrashScore, convergenceRate, activeSecondsToPass } = payload.summary.iteration;

  // We need at least thrashScore and convergenceRate to form a valid summary.
  if (typeof thrashScore !== "number" || typeof convergenceRate !== "number") {
    return null;
  }

  return {
    thrash_score: thrashScore,
    convergence_rate: convergenceRate,
    // Default to Infinity if missing (until David adds it)
    active_seconds_to_pass: typeof activeSecondsToPass === "number" ? activeSecondsToPass : Infinity,
  };
}
