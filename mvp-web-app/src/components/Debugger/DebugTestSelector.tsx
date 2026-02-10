"use client";

import React, { useState, useMemo } from "react";
import { CheckCircle, XCircle, Bug, AlertCircle } from "lucide-react";
import { Icons } from "@/components/ui/icons";
import { TestResult } from "@/components/ProblemPageRevamped/models";
import { TestCase } from "@/components/CodeEditor/types";
import { cn } from "@/lib/utils";

interface DebugTestSelectorProps {
  /** Test results from the last run (needed to know pass/fail status) */
  testResults: TestResult[];
  /** Official test cases (for names when no results yet) */
  officialTestCases: TestCase[];
  /** Called when user clicks a test case to start debugging that test */
  onStartDebug: (testName: string) => void;
  /** True while the debug worker is tracing */
  isTracing: boolean;
  /** Whether any tests have been run yet */
  hasRunTests: boolean;
}

/**
 * Shown in the Debug tab when no step-through trace is active.
 * Clicking a test case starts debugging that test (no separate Start button).
 */
export function DebugTestSelector({
  testResults,
  officialTestCases,
  onStartDebug,
  isTracing,
  hasRunTests,
}: DebugTestSelectorProps) {
  const [selectedTest, setSelectedTest] = useState<string | null>(null);

  // Sort: failing tests first, then passing, preserving original order within each group
  const sortedResults = useMemo(() => {
    if (testResults.length === 0) return [];
    const failing = testResults.filter((r) => !r.passed);
    const passing = testResults.filter((r) => r.passed);
    return [...failing, ...passing];
  }, [testResults]);

  // Auto-select first failing test if nothing selected
  const effectiveSelection = selectedTest ?? sortedResults.find((r) => !r.passed)?.name ?? null;

  if (!hasRunTests) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-zinc-600 mb-4" />
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Run Tests First</h3>
        <p className="text-xs text-zinc-500 max-w-sm">
          Click <strong>Run</strong> or <strong>Submit</strong> to execute your code, then come back here to debug a specific test.
        </p>
      </div>
    );
  }

  if (sortedResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <Bug className="h-10 w-10 text-zinc-600 mb-4" />
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">No Test Results</h3>
        <p className="text-xs text-zinc-500 max-w-sm">
          Run your tests first, then select a test to debug step-by-step.
        </p>
      </div>
    );
  }

  const hasFailingTests = sortedResults.some((r) => !r.passed);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <Bug className="h-4 w-4 text-yellow-500" />
          <h3 className="text-sm font-semibold text-zinc-200">Select a Test to Debug</h3>
        </div>
        <p className="text-[11px] text-zinc-500">
          {hasFailingTests
            ? "Click a test below to start debugging. Set breakpoints in the editor gutter first if you like."
            : "All tests passed. Click any test to step through its execution."}
        </p>
      </div>

      {/* Test list — clicking a test starts debugging */}
      <div className="flex-1 overflow-auto px-4 py-2 space-y-1">
        {sortedResults.map((result) => {
          const isSelected = effectiveSelection === result.name;
          const canStart = !isTracing;
          return (
            <button
              key={result.name}
              onClick={() => {
                setSelectedTest(result.name);
                if (canStart) onStartDebug(result.name);
              }}
              disabled={!canStart}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-lg border transition-all text-xs",
                !canStart && "cursor-not-allowed opacity-70",
                isSelected
                  ? "border-yellow-500/60 bg-yellow-500/10"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50",
              )}
            >
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                )}
                <span className={cn(
                  "font-medium truncate",
                  isSelected ? "text-zinc-100" : "text-zinc-300"
                )}>
                  {result.name}
                </span>
                {!result.passed && result.errorCode && (
                  <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-red-900/40 text-red-400 border border-red-800/50 shrink-0">
                    {result.errorCode.replace(/_/g, " ")}
                  </span>
                )}
                {result.passed && (
                  <span className="ml-auto px-1.5 py-0.5 text-[9px] rounded bg-green-900/40 text-green-400 border border-green-800/50 shrink-0">
                    PASSED
                  </span>
                )}
              </div>
              {/* Show error message preview for failing tests */}
              {!result.passed && result.printed && isSelected && (
                <p className="mt-1.5 text-[10px] text-zinc-500 truncate pl-5">
                  {result.printed.split("\n")[0]}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {isTracing && (
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Icons.spinner className="h-3.5 w-3.5 animate-spin" />
          Tracing...
        </div>
      )}
    </div>
  );
}
