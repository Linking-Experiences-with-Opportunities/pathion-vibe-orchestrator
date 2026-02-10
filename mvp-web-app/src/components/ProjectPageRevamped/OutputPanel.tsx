"use client";

import React from "react";
import { TestResult } from "../ProblemPageRevamped/models";
import { Terminal, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface OutputPanelProps {
  testResults: TestResult[];
  consoleOutput: string;
  isRunning: boolean;
  durationMs?: number;
}

/** Per-test execution block showing pass/fail status + captured print output */
function TestBlock({ test }: { test: TestResult }) {
  const passed = test.passed;
  const icon = passed ? (
    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
  ) : (
    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
  );

  // Use per-test captured stdout (consoleOutput) for print lines
  const output = test.consoleOutput ?? "";
  const hasOutput = output.trim() !== "";

  return (
    <div>
      {/* Test header */}
      <div
        className={`flex items-center justify-between py-1.5 px-3 rounded-md border ${
          passed
            ? "bg-gray-900/30 border-gray-800/50"
            : "bg-red-950/20 border-red-900/30"
        }`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span
            className={`text-sm font-medium ${
              passed ? "text-gray-300" : "text-red-400"
            }`}
          >
            Test: {test.name}
          </span>
          {!passed && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 tracking-wide">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Test body: captured print lines + error details */}
      <div className="pl-8 mt-2 font-mono text-sm">
        {hasOutput ? (
          <div className="space-y-1">
            {output
              .split("\n")
              .filter((l) => l.trim())
              .map((line, j) => (
                <div key={j} className="flex gap-2 text-gray-500">
                  <span className="text-gray-700 select-none opacity-50 font-bold shrink-0">
                    {">"}
                  </span>
                  <span className="whitespace-pre-wrap">{line}</span>
                </div>
              ))}
          </div>
        ) : (
          <span className="text-gray-700 italic text-xs">
            No output captured
          </span>
        )}

        {/* Error details for failing tests */}
        {!passed && test.errorTooltip && (
          <div className="mt-2 p-2 rounded bg-red-950/30 border border-red-900/20">
            <div className="flex items-center gap-1.5 text-xs text-red-400 mb-1">
              <XCircle className="w-3 h-3" />
              <span className="font-semibold">{test.errorTooltip}</span>
            </div>
            {test.expected != null && (
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div>
                  Expected:{" "}
                  <span className="text-green-400/70">
                    {JSON.stringify(test.expected)}
                  </span>
                </div>
                <div>
                  Actual:{" "}
                  <span className="text-red-400/70">
                    {JSON.stringify(test.actual)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const OutputPanel: React.FC<OutputPanelProps> = ({
  testResults,
  consoleOutput,
  isRunning,
  durationMs,
}) => {
  // Loading state
  if (isRunning) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 py-12">
        <Loader2 className="w-8 h-8 mb-3 text-blue-500 animate-spin" />
        <span className="text-sm font-medium">
          Running tests & capturing output...
        </span>
      </div>
    );
  }

  // Empty state
  if (testResults.length === 0 && !consoleOutput) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-600 py-12">
        <div className="p-5 rounded-full mb-4 bg-gray-900 border border-gray-800">
          <Terminal className="w-8 h-8 text-gray-700" />
        </div>
        <h3 className="text-gray-400 font-medium mb-1">
          Your print() output will appear here
        </h3>
        <p className="text-xs text-gray-600 max-w-xs text-center px-4">
          Run your code to see console output grouped by test.
        </p>
      </div>
    );
  }

  const passedCount = testResults.filter((t) => t.passed).length;
  const failedCount = testResults.length - passedCount;
  const consoleLines = consoleOutput
    ? consoleOutput.split("\n").filter((l) => l.trim())
    : [];

  return (
    <div className="h-full flex flex-col font-sans">
      {/* Summary bar */}
      <div className="shrink-0 h-10 border-b border-gray-800 bg-gray-900/40 flex items-center px-4 justify-between select-none">
        <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.15em]">
          Console Execution Log
        </span>
        <div className="flex items-center gap-3 text-xs font-medium">
          {testResults.length > 0 && (
            <>
              <span className="text-green-500">{passedCount} Passed</span>
              {failedCount > 0 && (
                <span className="text-red-500">{failedCount} Failed</span>
              )}
            </>
          )}
          {durationMs != null && (
            <span className="text-gray-600 ml-2">{durationMs}ms</span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Global / Setup prints */}
        {consoleLines.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 py-1 bg-gray-900/50 rounded-md px-3 border border-gray-800/50">
              <Terminal className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-[11px] font-bold uppercase text-gray-400">
                Setup & Module Load
              </span>
            </div>
            <div className="pl-8 font-mono text-sm space-y-1 text-gray-500">
              {consoleLines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-gray-700 select-none opacity-50 font-bold shrink-0">
                    {">"}
                  </span>
                  <span className="whitespace-pre-wrap">{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-test blocks */}
        <div className="space-y-4">
          {testResults.map((test, i) => (
            <TestBlock key={i} test={test} />
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 pb-8 border-t border-gray-900 flex justify-center">
          <span className="text-[10px] font-bold text-gray-800 uppercase tracking-widest">
            -- End of execution --
          </span>
        </div>
      </div>
    </div>
  );
};
