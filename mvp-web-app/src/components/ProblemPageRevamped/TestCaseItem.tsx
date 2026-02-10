"use client";

import React, { useState } from "react";
import { CheckCircle, XCircle, Play, Info, Sparkles, Zap, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TestCase } from "@/components/CodeEditor/types"
import { TestResult } from "./models"
import { Icons } from "@/components/ui/icons"
import { isRunnerSupported } from "@/lib/codeRunner"
import { UniversalErrorCode } from "@/lib/errorCodeMapper";
import { useNanoExplanation } from "@/hooks/useNanoExplanation"
import { getDeterministicError } from "@/lib/errorCategorization"
import { DataStructureViz } from "@/components/VizRenderers/DataStructureViz";
import { useVizCaption } from "@/hooks/useVizCaption";
import { logTestCaseExpand } from "@/lib/actionLogger";

interface TestCaseItemProps {
  test: TestCase;
  result?: TestResult;
  testCaseNumber: number;
  runIndividualTestCase: (testCaseNumber: number) => void
  isLoading: boolean;
  code: string;
}

/** Format error code for display (e.g., "RUNTIME_ERROR" -> "Runtime Error") */
function formatErrorCode(code: UniversalErrorCode): string {
  if (!code) return "";
  return code
    .split("_")
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/** Get styling for error category badge based on error type */
function getErrorBadgeStyles(code: UniversalErrorCode): string {
  switch (code) {
    case "COMPILATION_ERROR":
      return "bg-orange-900/50 text-orange-300 border-orange-700";
    case "RUNTIME_ERROR":
      return "bg-red-900/50 text-red-300 border-red-700";
    case "TEST_FAILED":
      return "bg-yellow-900/50 text-yellow-300 border-yellow-700";
    case "MISSING_EXPECTED_ERROR":
      return "bg-purple-900/50 text-purple-300 border-purple-700";
    case "TIMEOUT":
      return "bg-blue-900/50 text-blue-300 border-blue-700";
    case "MEMORY_LIMIT":
      return "bg-pink-900/50 text-pink-300 border-pink-700";
    default:
      return "bg-gray-900/50 text-gray-300 border-gray-700";
  }
}

/** Get hover background color based on error type (more transparent version) */
function getHoverBgColor(code: UniversalErrorCode): string {
  switch (code) {
    case "COMPILATION_ERROR":
      return "hsla(17, 88.30%, 40.40%, 0.42)";  // orange
    case "RUNTIME_ERROR":
      return "rgba(185, 28, 28, 0.40)";  // red
    case "TEST_FAILED":
      return "rgba(161, 98, 7, 0.40)";   // yellow
    case "MISSING_EXPECTED_ERROR":
      return "rgba(126, 34, 206, 0.40)"; // purple
    case "TIMEOUT":
      return "rgba(29, 78, 216, 0.40)";  // blue
    case "MEMORY_LIMIT":
      return "rgba(190, 24, 93, 0.40)";  // pink
    default:
      return "rgba(239, 68, 68, 0.40)";  // default red
  }
}

/** Get text color for tooltip based on error type */
function getTooltipTextColor(code: UniversalErrorCode): string {
  switch (code) {
    case "COMPILATION_ERROR":
      return "text-orange-200";
    case "RUNTIME_ERROR":
      return "text-red-200";
    case "TEST_FAILED":
      return "text-yellow-200";
    case "MISSING_EXPECTED_ERROR":
      return "text-purple-200";
    case "TIMEOUT":
      return "text-blue-200";
    case "MEMORY_LIMIT":
      return "text-pink-200";
    default:
      return "text-gray-200";
  }
}

export const TestCaseItem: React.FC<TestCaseItemProps> = ({
  test,
  result,
  runIndividualTestCase,
  testCaseNumber,
  isLoading,
  code,
}) => {

  const [showTestDetails, setShowTestDetails] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // Nano Explanation (Error Summary)
  const { generateExplanation, explanationResult, loading: explainLoading, error: explainError, isAvailable, availabilityStatus } = useNanoExplanation();

  // Nano Caption (Viz)
  const { generateCaption, caption, loading: captionLoading, error: captionError, isAvailable: captionAvailable } = useVizCaption();

  // Cloud Trace (Gemini 3)
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceResult, setTraceResult] = useState<string | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  // Auto-generate Viz Caption if vizPayload exists
  React.useEffect(() => {
    if (showTestDetails && result?.vizPayload?.viz && captionAvailable && !caption && !captionLoading) {
      generateCaption(result.vizPayload.viz);
    }
  }, [showTestDetails, result, captionAvailable, caption, captionLoading, generateCaption]);

  // Determine if this test has an error to show tooltip for
  const hasError = result && !result.passed && result.errorCode && result.errorTooltip;
  const hoverBgColor = hasError ? getHoverBgColor(result!.errorCode!) : undefined;
  const baseBgColor = result && !result.passed ? "rgba(127, 29, 29, 0.2)" : undefined;

  const getStatusMessage = () => {
    switch (availabilityStatus) {
      case "checking":
        return "Checking AI availability...";
      case "unsupported":
        return "Requires Chrome 121+ with Prompt API enabled";
      case "unavailable":
        return "Gemini Nano not available on this device";
      case "downloadable":
        return "Model needs download. Check chrome://components";
      case "downloading":
        return "Model downloading...";
      case "available":
        return undefined;
      default:
        return "AI not available";
    }
  };

  const handleExplainError = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!result?.printed) return;
    const { code, rawMessage } = getDeterministicError(result.printed, result.errorCode ?? undefined);
    await generateExplanation(result.errorCode ?? code, rawMessage);
  };

  const handleDeepTrace = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!result) return;

    setTraceLoading(true);
    setTraceError(null);
    setTraceResult(null);

    console.log("[TestCaseItem] Initiating Deep Trace with payload:", result.vizPayload);

    try {
      const response = await fetch('/api/ai-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          language: "python",
          problemDescription: "Debug Analysis",
          failedTestInput: test.input,
          actualOutput: result.actual,
          errorLog: result.printed,
          vizPayload: result.vizPayload
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setTraceResult(data.trace);

    } catch (err: any) {
      setTraceError(err.message || "Trace failed");
    } finally {
      setTraceLoading(false);
    }
  };

  const hasViz = !!result?.vizPayload?.viz;

  return (
    <div
      className={cn(
        "p-2 rounded border border-[#2e3d4d] relative transition-all duration-200 cursor-pointer",
        isLoading && "animate-pulse",
        result?.passed && "border-green-800 bg-[#1e2d3d]",
        result && !result.passed && "border-red-800"
      )}
      style={{
        backgroundColor: isHovered && !showTestDetails && hoverBgColor ? hoverBgColor : baseBgColor || "#1e2d3d",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        const newState = !showTestDetails;
        setShowTestDetails(newState);
        // Log test case expansion (only when expanding, not collapsing)
        if (newState) {
          logTestCaseExpand(testCaseNumber);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {result &&
            (result.passed ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            ))}
          <span className="text-sm font-medium">{test.Name}</span>

          {/* Error Category Badge */}
          {result && !result.passed && result.errorCode && (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border",
                getErrorBadgeStyles(result.errorCode)
              )}
            >
              {formatErrorCode(result.errorCode)}
              <Info className="h-3 w-3 opacity-60" />
            </span>
          )}
        </div>

        {isLoading ? (
          <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading || !isRunnerSupported()}
            className="h-7 text-xs bg-[#0a192f] hover:bg-[#0d1b2a] border-[#2e3d4d] z-0"
            onClick={(e) => {
              runIndividualTestCase(testCaseNumber)
              e.stopPropagation();
            }}
          >
            <Play className="h-3 w-3 mr-1" />
            Run
          </Button>
        )}
      </div>

      {/* Only show hover tooltip when card is not expanded; when expanded, details are in showTestDetails block */}
      {hasError && isHovered && !showTestDetails && (
        <div className="mt-2 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-xs">
              {formatErrorCode(result!.errorCode!)}
            </span>
          </div>
          <p className={cn("text-xs leading-relaxed opacity-90", getTooltipTextColor(result!.errorCode!))}>
            {result!.errorTooltip}
          </p>
        </div>
      )}

      {showTestDetails && (
        <div className="mt-2 pl-6 text-xs">
          <div className="space-y-2">
            <div className="text-gray-400 font-mono">Input: {test.input}</div>
            <div className="text-gray-400 font-mono">Expected: {test.expected_output}</div>
          </div>

          {result && !result.passed && (
            <div className="mt-2">
              <div className="flex flex-col gap-2">
                {/* Error Category Card */}
                {result.errorCode && result.errorTooltip && (
                  <div className={cn("p-2 rounded border", getErrorBadgeStyles(result.errorCode))}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-xs">{formatErrorCode(result.errorCode)}</span>
                    </div>
                    <p className="text-[11px] opacity-80 leading-relaxed">{result.errorTooltip}</p>
                  </div>
                )}

                {/* VISUALIZATION SECTION */}
                {hasViz && (
                  <div className="mt-2 border border-slate-700/50 rounded-lg overflow-hidden bg-[#0a1019]">
                    <div className="p-2 border-b border-slate-700/50 flex items-center justify-between bg-slate-900/50">
                      <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                        <BrainCircuit className="h-3 w-3 text-blue-400" />
                        Memory State
                        {result.vizPayload?.viz?.truncated && (
                          <span className="ml-2 px-1.5 py-0.5 bg-amber-900/50 text-amber-500 text-[10px] rounded border border-amber-700/50 flex items-center gap-1" title="Graph truncated after 20 nodes. Likely infinite loop.">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Truncated
                          </span>
                        )}
                      </span>
                      {caption && (
                        <span className="text-[10px] text-purple-300 italic max-w-[70%] truncate">
                          {caption}
                        </span>
                      )}
                    </div>
                    <div className="p-2 relative group">
                      <DataStructureViz viz={result.vizPayload?.viz ?? null} />
                      {captionLoading && (
                        <div className="absolute top-2 right-2 text-[10px] text-slate-500 animate-pulse">
                          Analyzing...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Output display */}
                {result.actual && (
                  <p><span className="text-gray-400">Reason:</span> <span className="font-mono whitespace-pre-wrap">{result.actual}</span></p>
                )}
                {result.printed && (
                  <p><span className="text-gray-400">Output:</span> <br /><span className="whitespace-pre-wrap">{result.printed}</span></p>
                )}

                {/* ACTION BUTTONS */}
                {result && !result.passed && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {/* 1. Nano Error Summary */}
                    <button
                      onClick={handleExplainError}
                      disabled={explainLoading || !isAvailable}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all group border border-transparent hover:border-blue-500/30",
                        isAvailable && !explainLoading
                          ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                          : "bg-gray-800 text-gray-500 cursor-not-allowed"
                      )}
                    >
                      {explainLoading ? <Icons.spinner className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Explain Error
                    </button>

                    {/* 2. Cloud Deep Trace (Evidence-Driven) */}
                    <button
                      onClick={handleDeepTrace}
                      disabled={traceLoading}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all group border border-transparent hover:border-purple-500/30",
                        !traceLoading
                          ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                          : "bg-gray-800 text-gray-500 cursor-not-allowed"
                      )}
                    >
                      {traceLoading ? <Icons.spinner className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Deep Trace (Gemini 3)
                    </button>
                  </div>
                )}

                {/* AI RESPONSES */}
                {/* Nano Result */}
                {explanationResult && (
                  <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-2">
                    <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                      <span className="text-[10px] text-blue-400 block mb-1 uppercase tracking-wider">Nano Summary</span>
                      <p className="text-xs text-gray-300">
                        {'explanation' in explanationResult ? explanationResult.explanation : explanationResult.analysis}
                      </p>
                    </div>
                    {/* Tips */}
                    {("fix_code" in explanationResult && explanationResult.fix_code) ||
                      ("optimization_tip" in explanationResult && explanationResult.optimization_tip) ||
                      ("analogy" in explanationResult && explanationResult.analogy) ? (
                      <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded">
                        <span className="text-xs text-amber-400 block mb-1">Tip</span>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap">
                          {"fix_code" in explanationResult && explanationResult.fix_code
                            ? explanationResult.fix_code
                            : "optimization_tip" in explanationResult && explanationResult.optimization_tip
                              ? explanationResult.optimization_tip
                              : "analogy" in explanationResult
                                ? explanationResult.analogy
                                : ""}
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Gemini 3 Trace Result */}
                {traceResult && (
                  <div className="mt-2 animate-in fade-in slide-in-from-top-2">
                    <div className="p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg">
                      <span className="text-[10px] text-purple-400 block mb-2 uppercase tracking-wider flex items-center gap-1">
                        <Zap className="h-3 w-3" /> Deep Trace Analysis
                      </span>
                      <div className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed prose prose-invert max-w-none">
                        {traceResult}
                      </div>
                    </div>
                  </div>
                )}

                {traceError && (
                  <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                    {traceError}
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
