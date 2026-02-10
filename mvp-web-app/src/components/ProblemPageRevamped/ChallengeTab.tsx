"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import { Swords, RotateCcw, Play, Loader2, Shield, ShieldAlert, ShieldCheck, FlaskConical } from "lucide-react";
import {
  generateBossScript,
  parseBossResult,
  detectClassName,
  stripFileHeaders,
  generateUserTestCode,
} from "@/lib/bossTestHarness";
import {
  pickTargetMethod,
  minimizeSeedArray,
  type MinimizationResult,
} from "@/lib/challengeMode";
import { runCode } from "@/lib/codeRunner";
import { trackTelemetry } from "@/lib/telemetryClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChallengeState =
  | "idle"
  | "generating"       // Calling Gemini via /api/challenge
  | "running_harness"  // Executing boss scripts in Pyodide
  | "minimizing"       // Running greedy minimization
  | "success"          // Found a failing edge case
  | "no_counterexample"
  | "error";

interface BossResult {
  inputArray: number[];
  failingTestName?: string;
  expected?: unknown;
  actual?: unknown;
  errorLog?: string;
  strategy?: string;
  modelInfo?: {
    provider: "gemini";
    model: string;
    reasoningSummary?: string;
  };
}

interface MinimizedResult {
  inputArray: number[];
  minimization: MinimizationResult;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChallengeTabProps {
  /** The project / problem ID for this challenge. */
  projectId: string;
  /** Optional session ID for telemetry / storage. */
  sessionId?: string;
  /** Current code snapshot from the editor (may include ### File: headers). */
  codeSnapshot: string;
  /** Language (currently only "python"). */
  language: string;
  /** Optional callback when user wants to run the found case in the main editor. */
  onRunCase?: (seedArray: number[]) => void;
  /** Callback to add a generated test to the User Tests tab. */
  onAddToUserTests?: (testCode: string) => void;
}

// ---------------------------------------------------------------------------
// Helper: status copy
// ---------------------------------------------------------------------------

const STATUS_COPY: Record<ChallengeState, string> = {
  idle: "",
  generating: "Boss is picking an attack strategy...",
  running_harness: "Boss is attacking your code...",
  minimizing: "Boss is finding the smallest input that breaks it...",
  success: "",
  no_counterexample: "",
  error: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChallengeTab({
  projectId,
  sessionId,
  codeSnapshot,
  language,
  onRunCase,
  onAddToUserTests,
}: ChallengeTabProps) {
  const [state, setState] = useState<ChallengeState>("idle");
  const [bossResult, setBossResult] = useState<BossResult | null>(null);
  const [minimized, setMinimized] = useState<MinimizedResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTargetMethod, setLastTargetMethod] = useState<string>("resize");
  const [addedToTests, setAddedToTests] = useState(false);
  const abortRef = useRef(false);

  // Detect the student's class name from their code (e.g., MyArrayList)
  const className = useMemo(() => detectClassName(codeSnapshot), [codeSnapshot]);

  // Clean code: strip ### File: headers so it's valid Python
  const cleanCode = useMemo(() => stripFileHeaders(codeSnapshot), [codeSnapshot]);

  // -----------------------------------------------------------------------
  // Run boss test harness against a single seed array using the main
  // Pyodide worker (via runCode), not a separate shadow runner.
  // -----------------------------------------------------------------------
  const runBossTest = useCallback(
    async (
      seedArray: number[],
      targetMethod: string
    ): Promise<{ pass: boolean; failingTest?: string; expected?: unknown; actual?: unknown; error?: string }> => {
      const bossScript = generateBossScript(targetMethod, seedArray, className);
      // Combine student code + boss script into a single Python program
      const fullScript = cleanCode + "\n\n" + bossScript;

      try {
        // Run through the main Pyodide code runner. We pass a no-op dummy
        // test case because runInWorker requires at least one. The boss
        // script handles its own assertions via the BOSS_RESULT protocol.
        const result = await runCode(
          fullScript,
          [{ id: "boss_noop", fn: "__boss_noop__" }],
          {
            timeoutMs: 10000,
            memLimitMB: 128,
            problemId: projectId,
          }
        );

        const parsed = parseBossResult(result.stdout);

        if (!parsed) {
          // If we got a stderr error, treat as fail
          if (result.exitCode !== 0 || result.stderr) {
            return {
              pass: false,
              failingTest: "boss_execution_error",
              error: result.stderr || "Script failed with no output",
            };
          }
          // No result marker found, assume pass
          return { pass: true };
        }

        return {
          pass: parsed.pass,
          failingTest: parsed.failingTest,
          expected: parsed.expected,
          actual: parsed.actual,
          error: parsed.error,
        };
      } catch (err) {
        return {
          pass: false,
          failingTest: "boss_exception",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [cleanCode, className, projectId]
  );

  // -----------------------------------------------------------------------
  // Main boss fight flow
  // -----------------------------------------------------------------------
  const handleFightBoss = useCallback(async () => {
    abortRef.current = false;
    setBossResult(null);
    setMinimized(null);
    setErrorMessage(null);
    setAddedToTests(false);

    // Track boss fight initiation
    trackTelemetry("boss_fight_started", { projectId });

    // ------------------------------------------------------------------
    // Step 1: Call /api/challenge to get Gemini candidates
    // ------------------------------------------------------------------
    setState("generating");

    let candidates: { seedArray: number[]; why: string }[] = [];
    let targetMethod = "resize";
    let modelInfo: BossResult["modelInfo"];
    let strategy: string | undefined;

    try {
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          projectId,
          codeSnapshot,
          language,
        }),
      });

      const data = await res.json();

      if (data.status === "error") {
        trackTelemetry("boss_fight_result", {
          projectId,
          status: "error",
          error: data.ui?.hint ?? "Failed to generate boss attack.",
        });
        setState("error");
        setErrorMessage(data.ui?.hint ?? "Failed to generate boss attack.");
        return;
      }

      if (data.status === "no_counterexample" || !data.candidates?.length) {
        trackTelemetry("boss_fight_result", {
          projectId,
          status: "no_counterexample",
          source: "gemini",
        });
        setState("no_counterexample");
        return;
      }

      candidates = data.candidates;
      targetMethod = data.targetMethod ?? pickTargetMethod(codeSnapshot);
      setLastTargetMethod(targetMethod);
      modelInfo = data.model;
      strategy = data.strategy;
    } catch (err) {
      trackTelemetry("boss_fight_result", {
        projectId,
        status: "error",
        error: err instanceof Error ? err.message : "Network error",
      });
      setState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Network error calling boss API."
      );
      return;
    }

    if (abortRef.current) return;

    // ------------------------------------------------------------------
    // Step 2: Run boss harness for each candidate in Pyodide
    // ------------------------------------------------------------------
    setState("running_harness");

    let failingSeed: number[] | null = null;
    let failResult: Awaited<ReturnType<typeof runBossTest>> | null = null;

    for (const candidate of candidates) {
      if (abortRef.current) return;

      const result = await runBossTest(candidate.seedArray, targetMethod);
      if (!result.pass) {
        failingSeed = candidate.seedArray;
        failResult = result;
        break;
      }
    }

    if (!failingSeed || !failResult) {
      trackTelemetry("boss_fight_result", {
        projectId,
        status: "no_counterexample",
        targetMethod,
        strategy,
        candidateCount: candidates.length,
        model: modelInfo,
      });
      setState("no_counterexample");
      return;
    }

    if (abortRef.current) return;

    // Store the original failing result
    const original: BossResult = {
      inputArray: failingSeed,
      failingTestName: failResult.failingTest,
      expected: failResult.expected,
      actual: failResult.actual,
      errorLog: failResult.error,
      strategy,
      modelInfo,
    };
    setBossResult(original);

    // ------------------------------------------------------------------
    // Step 3: Minimise the failing seed array
    // ------------------------------------------------------------------
    setState("minimizing");

    let minimizedSeedArray = failingSeed;
    try {
      const minimizationResult = await minimizeSeedArray(
        failingSeed,
        async (arr) => {
          const r = await runBossTest(arr, targetMethod);
          return { pass: r.pass, failingTest: r.failingTest };
        },
        5000 // 5 second budget
      );

      minimizedSeedArray = minimizationResult.inputArray;
      setMinimized({
        inputArray: minimizationResult.inputArray,
        minimization: minimizationResult,
      });

      // Update boss result with minimised array if it's smaller
      if (minimizationResult.inputArray.length < failingSeed.length) {
        // Re-run with minimised array to get updated expected/actual
        const minResult = await runBossTest(
          minimizationResult.inputArray,
          targetMethod
        );
        setBossResult((prev) =>
          prev
            ? {
                ...prev,
                inputArray: minimizationResult.inputArray,
                failingTestName: minResult.failingTest ?? prev.failingTestName,
                expected: minResult.expected ?? prev.expected,
                actual: minResult.actual ?? prev.actual,
                errorLog: minResult.error ?? prev.errorLog,
              }
            : prev
        );
      }
    } catch (err) {
      // Minimisation failure is non-fatal -- we still have the original
      console.warn("[ChallengeTab] minimization error:", err);
    }

    // Track boss fight result with full context
    trackTelemetry("boss_fight_result", {
      projectId,
      status: "success",
      targetMethod,
      strategy,
      candidates: candidates.map((c) => ({
        seedArray: c.seedArray,
        why: c.why,
      })),
      failingSeed: failingSeed,
      minimizedSeed: minimizedSeedArray,
      failingTest: failResult?.failingTest,
      expected: failResult?.expected,
      actual: failResult?.actual,
      errorLog: failResult?.error,
      model: modelInfo,
    });

    setState("success");
  }, [
    codeSnapshot,
    language,
    projectId,
    sessionId,
    runBossTest,
  ]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const isLoading =
    state === "generating" ||
    state === "running_harness" ||
    state === "minimizing";

  return (
    <div className="p-4 max-h-[50vh] overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10">
          <Swords className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Boss Fight</h2>
          <p className="text-xs text-zinc-400">
            Can the boss find an edge case that breaks your code?
          </p>
        </div>
      </div>

      {/* Idle state */}
      {state === "idle" && (
        <div className="text-center py-8">
          <div className="flex items-center justify-center mb-4">
            <Shield className="h-12 w-12 text-amber-400/60" />
          </div>
          <p className="text-zinc-300 mb-2 text-sm">
            You passed the basics... wanna fight the ArrayList boss?
          </p>
          <p className="text-zinc-500 mb-6 text-xs">
            The boss will use AI to generate adversarial test inputs
            targeting the weakest parts of your implementation.
          </p>
          <button
            type="button"
            onClick={handleFightBoss}
            className="px-6 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm transition-colors flex items-center gap-2 mx-auto"
          >
            <Swords className="h-4 w-4" />
            Fight Boss
          </button>
        </div>
      )}

      {/* Loading states */}
      {isLoading && (
        <div className="text-center py-8">
          <Loader2 className="h-10 w-10 text-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-amber-300 font-medium text-sm">
            {STATUS_COPY[state]}
          </p>
          <div className="mt-4 flex justify-center">
            <div className="w-48 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full animate-pulse"
                style={{
                  width:
                    state === "generating"
                      ? "33%"
                      : state === "running_harness"
                        ? "66%"
                        : "90%",
                  transition: "width 0.5s ease-in-out",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Success: found an edge case */}
      {state === "success" && bossResult && (
        <div className="space-y-4">
          {/* Badge */}
          <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/30 bg-red-900/10">
            <ShieldAlert className="h-5 w-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-300 font-semibold text-sm">
                Boss attack found a weakness!
              </p>
              {bossResult.strategy && (
                <p className="text-zinc-400 text-xs mt-0.5">
                  Strategy: {bossResult.strategy}
                </p>
              )}
            </div>
          </div>

          {/* Minimised array */}
          <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <p className="text-xs text-zinc-400 mb-1 font-medium uppercase tracking-wide">
              {minimized ? "Minimized Input" : "Failing Input"}
            </p>
            <code className="text-amber-300 text-sm font-mono block">
              [{(minimized?.inputArray ?? bossResult.inputArray).join(", ")}]
            </code>
            {minimized && minimized.inputArray.length < bossResult.inputArray.length && (
              <p className="text-zinc-500 text-xs mt-1">
                Reduced from {bossResult.inputArray.length} to{" "}
                {minimized.inputArray.length} elements (
                {minimized.minimization.stopReason === "len<=3"
                  ? "minimum length reached"
                  : minimized.minimization.stopReason === "time_budget"
                    ? `time budget: ${minimized.minimization.elapsedMs}ms`
                    : "no further reduction possible"}
                )
              </p>
            )}
          </div>

          {/* Expected vs Actual */}
          {(bossResult.expected !== undefined ||
            bossResult.actual !== undefined) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-green-900/10 border border-green-800/30">
                <p className="text-xs text-green-400 mb-1 font-medium uppercase tracking-wide">
                  Expected
                </p>
                <code className="text-green-300 text-sm font-mono">
                  {JSON.stringify(bossResult.expected)}
                </code>
              </div>
              <div className="p-3 rounded-lg bg-red-900/10 border border-red-800/30">
                <p className="text-xs text-red-400 mb-1 font-medium uppercase tracking-wide">
                  Actual
                </p>
                <code className="text-red-300 text-sm font-mono">
                  {JSON.stringify(bossResult.actual)}
                </code>
              </div>
            </div>
          )}

          {/* Error details */}
          {bossResult.errorLog && (
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <p className="text-xs text-zinc-400 mb-1 font-medium uppercase tracking-wide">
                What happened
              </p>
              <p className="text-zinc-300 text-sm">{bossResult.errorLog}</p>
            </div>
          )}

          {/* Failing test name */}
          {bossResult.failingTestName && (
            <p className="text-xs text-zinc-500">
              Failing check:{" "}
              <code className="text-zinc-400">
                {bossResult.failingTestName}
              </code>
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            {onAddToUserTests && (
              <button
                type="button"
                disabled={addedToTests}
                onClick={() => {
                  const finalArray = minimized?.inputArray ?? bossResult.inputArray;
                  const testCode = generateUserTestCode(
                    lastTargetMethod,
                    finalArray,
                    className,
                    bossResult.failingTestName,
                    bossResult.errorLog
                  );
                  onAddToUserTests(testCode);
                  setAddedToTests(true);
                  trackTelemetry("boss_fight_added_to_tests", {
                    projectId,
                    targetMethod: lastTargetMethod,
                    seedArray: finalArray,
                  });
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${
                  addedToTests
                    ? "bg-green-700/50 text-green-300 cursor-default"
                    : "bg-blue-600 hover:bg-blue-500 text-white"
                }`}
              >
                <FlaskConical className="h-4 w-4" />
                {addedToTests ? "Added to My Tests" : "Add to My Tests"}
              </button>
            )}
            {onRunCase && (
              <button
                type="button"
                onClick={() =>
                  onRunCase(
                    minimized?.inputArray ?? bossResult.inputArray
                  )
                }
                className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Run This Case
              </button>
            )}
            <button
              type="button"
              onClick={handleFightBoss}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Try Again
            </button>
          </div>

          {/* Model attribution */}
          {bossResult.modelInfo && (
            <p className="text-[10px] text-zinc-600 pt-2">
              Powered by {bossResult.modelInfo.model} (
              {bossResult.modelInfo.provider})
            </p>
          )}
        </div>
      )}

      {/* No counterexample found */}
      {state === "no_counterexample" && (
        <div className="text-center py-8">
          <ShieldCheck className="h-12 w-12 text-green-400 mx-auto mb-4" />
          <p className="text-green-300 font-semibold text-sm mb-2">
            Boss couldn&apos;t break your code!
          </p>
          <p className="text-zinc-400 text-xs mb-6">
            The AI-generated edge cases all passed. Nice work! Try again
            for a tougher challenge.
          </p>
          <button
            type="button"
            onClick={handleFightBoss}
            className="px-5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <RotateCcw className="h-4 w-4" />
            Fight Again
          </button>
        </div>
      )}

      {/* Error state */}
      {state === "error" && (
        <div className="text-center py-8">
          <ShieldAlert className="h-12 w-12 text-red-400/60 mx-auto mb-4" />
          <p className="text-red-300 font-semibold text-sm mb-2">
            Boss fight encountered an error
          </p>
          {errorMessage && (
            <p className="text-zinc-400 text-xs mb-6 max-w-sm mx-auto">
              {errorMessage}
            </p>
          )}
          <button
            type="button"
            onClick={handleFightBoss}
            className="px-5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export default ChallengeTab;
