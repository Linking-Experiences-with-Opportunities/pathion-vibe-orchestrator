"use client";

import { useState, useCallback, useRef } from "react";
import { useShadowRunner } from "./useShadowRunner";
import { extractAST } from "@/lib/astExtractor";
import { callVerificationAgent } from "@/lib/verificationAgentClient";
import {
  computePlaceholderMetrics,
  mapDavidSummaryToSessionSummary,
  THRASH_THRESHOLD,
  AGENT_COOLDOWN_MS,
  type RunEvent,
  type ReportCard,
  type CognitiveShadowFrame,
  type SessionSummary,
  type DavidSessionSummaryPayload,
} from "@/lib/verificationAgent";
import type { TestResult } from "@/components/ProblemPageRevamped/models";
import type { VizPayloadV1 } from "@/lib/vizPayload";

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

export interface UseVerificationAgentResult {
  /** The latest Report Card from the Verification Agent, or null. */
  reportCard: ReportCard | null;
  /** Cognitive Shadow frames from the latest analysis. */
  cognitiveShadow: CognitiveShadowFrame[];
  /** Whether the agent is currently analyzing (calling Gemini). */
  isAnalyzing: boolean;
  /** Latest computed session metrics (for debug display). */
  metrics: SessionSummary | null;
  /** Error message if the last agent call failed. */
  error: string | null;
  /** Record a new run event and potentially trigger the agent. */
  recordRun: (
    code: string,
    testResults: TestResult[],
    vizPayload?: VizPayloadV1 | null,
    davidSummary?: DavidSessionSummaryPayload | null
  ) => void;
  /** Clear the report card (e.g., when user dismisses it). */
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// Rolling Window
// ---------------------------------------------------------------------------

/** Max events to keep in the rolling window. */
const MAX_EVENTS = 20;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Monitors user runs for thrashing patterns and triggers the Verification Agent
 * (Gemini 3 Pro Preview) when thrash_score exceeds the threshold.
 *
 * Usage:
 * ```tsx
 * const { reportCard, cognitiveShadow, isAnalyzing, recordRun, dismiss } =
 *   useVerificationAgent();
 *
 * // Call on every Run / Submit:
 * recordRun(currentCode, testResults, vizPayload);
 * ```
 */
export function useVerificationAgent(): UseVerificationAgentResult {
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  const [cognitiveShadow, setCognitiveShadow] = useState<CognitiveShadowFrame[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metrics, setMetrics] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rolling event history
  const eventHistoryRef = useRef<RunEvent[]>([]);

  // Cooldown tracking
  const lastTriggerRef = useRef<number>(0);

  // Shadow runner for AST extraction
  const { run: runPyodide } = useShadowRunner({ timeoutMs: 3000 });

  /**
   * Record a new run/submit event and check if we should trigger the agent.
   */
  const recordRun = useCallback(
    async (
      code: string,
      testResults: TestResult[],
      vizPayload?: VizPayloadV1 | null,
      davidSummary?: DavidSessionSummaryPayload | null
    ) => {
      // [verification-agent] Step 0: ingestion — where David's Session Summary / event stream will feed in
      const passed = testResults.filter((t) => t.passed).length;
      const failed = testResults.filter((t) => !t.passed).length;
      const total = testResults.length;

      console.log("[verification-agent] Step 0: ingestion", {
        codeLength: code?.length ?? 0,
        passed,
        failed,
        total,
        hasVizPayload: !!vizPayload,
        source: "testResults (placeholder until David's instrumentation)",
      });

      const event: RunEvent = {
        timestamp: Date.now(),
        passed,
        failed,
        total,
      };

      // Append to rolling window
      const history = [...eventHistoryRef.current, event].slice(-MAX_EVENTS);
      eventHistoryRef.current = history;
      console.log("[verification-agent] Step 0: event history updated", {
        windowLength: history.length,
        lastEvent: { passed: event.passed, failed: event.failed, total: event.total },
      });

      // Compute metrics (Step 1): Use David's summary if available, else placeholder
      let currentMetrics: SessionSummary;
      const mappedDavidMetrics = mapDavidSummaryToSessionSummary(davidSummary);

      if (mappedDavidMetrics) {
        currentMetrics = mappedDavidMetrics;
        console.log("[verification-agent] Step 1: metrics sourced from David", {
          metrics: currentMetrics,
        });
      } else {
        currentMetrics = computePlaceholderMetrics(history);
        console.log("[verification-agent] Step 1: metrics sourced from placeholder", {
          metrics: currentMetrics,
        });
      }

      setMetrics(currentMetrics);

      // --- Step 2: gate — should we trigger? ---
      if (currentMetrics.thrash_score <= THRASH_THRESHOLD) {
        console.log("[verification-agent] Step 2: gate — skip", {
          reason: "thrash_score below threshold",
          thrash_score: currentMetrics.thrash_score.toFixed(2),
          threshold: THRASH_THRESHOLD,
        });
        return;
      }
      if (isAnalyzing) {
        console.log("[verification-agent] Step 2: gate — skip", { reason: "already analyzing" });
        return;
      }
      if (Date.now() - lastTriggerRef.current < AGENT_COOLDOWN_MS) {
        console.log("[verification-agent] Step 2: gate — skip", {
          reason: "cooldown active",
          remainingMs: AGENT_COOLDOWN_MS - (Date.now() - lastTriggerRef.current),
        });
        return;
      }
      if (failed === 0) {
        console.log("[verification-agent] Step 2: gate — skip", { reason: "this run passed" });
        return;
      }

      console.log("[verification-agent] Step 2: gate — TRIGGER", {
        thrash_score: currentMetrics.thrash_score.toFixed(2),
        convergence_rate: currentMetrics.convergence_rate.toFixed(2),
      });

      lastTriggerRef.current = Date.now();
      setIsAnalyzing(true);
      setError(null);

      try {
        // Step 3: Extract simplified AST
        const astDump = await extractAST(code, runPyodide);

        // Build failed test context
        const failedTests = testResults
          .filter((t) => !t.passed)
          .slice(0, 5)
          .map((t) => ({
            testName: t.name,
            status: t.passed ? "passed" : "failed",
            message: t.printed ?? null,
            errorCode: t.errorCode ?? null,
          }));

        // Step 4: Call the Verification Agent API
        const result = await callVerificationAgent({
          code,
          astDump,
          metrics: currentMetrics,
          failedTests,
          vizSnapshot: vizPayload?.viz?.stateSnapshot ?? null,
        });

        setReportCard(result.reportCard);
        setCognitiveShadow(result.cognitiveShadow ?? []);

        console.log("[verification-agent] Step 5: pipeline complete — UI updated", {
          diagnosisPreview: result.reportCard.diagnosis.slice(0, 60),
          challengeLength: result.reportCard.verificationChallenge.length,
          shadowFrames: result.cognitiveShadow?.length ?? 0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Verification agent failed";
        console.error("[verification-agent] Step 5: pipeline error", { error: msg });
        setError(msg);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [isAnalyzing, runPyodide]
  );

  /**
   * Dismiss the current report card.
   */
  const dismiss = useCallback(() => {
    setReportCard(null);
    setCognitiveShadow([]);
    setError(null);
  }, []);

  return {
    reportCard,
    cognitiveShadow,
    isAnalyzing,
    metrics,
    error,
    recordRun,
    dismiss,
  };
}
