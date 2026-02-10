"use client";

import React, { useEffect, useRef } from "react";
import { TestResultsPanel } from "./TestResultsPanel";
import { QuestionData } from "../CodeEditor/types";
import CodeEditor from "@/components/CodeEditor/CodeEditor";
import { Module } from "@/components/Admin/modules/ModuleList";
import { EditorSignalsTracker } from "@/lib/editorSignals";
import { CanonicalSyntaxError } from "@/hooks/useCanonicalSyntaxCheck";
import { UseExecutionHistoryResult } from "@/hooks/useExecutionHistory";
import { UseStepDebuggerResult } from "@/hooks/useStepDebugger";
import { UseBreakpointsResult } from "@/hooks/useBreakpoints";
import {
  setTrackingContext,
  setContentGetter,
  startDiffTracking,
  cleanupDiffTracking,
  updateLiveContent,
} from "@/lib/inputDiffTracker";
import { startAttemptSession, cleanupAttemptSession } from "@/lib/attemptSession";

interface RightPanelProps {
  activeTestTab: string;
  setActiveTestTab: (tab: string) => void;
  problemData: QuestionData | null;
  splitPosition: number;
  setUserAnswer: (answer: string) => void;
  userAnswer: string | null;
  contentIndex: number | null;
  module: Module | undefined;
  handleSubmitCode: () => void;
  submissionLoading: boolean;
  autoSaveKey?: string;
  onAutoSave?: (code: string) => void;
  signalsTracker?: EditorSignalsTracker;
  onAllTestsPassed?: () => void;
  syntaxError?: CanonicalSyntaxError | null;
  isValidating?: boolean;
  executionHistory?: UseExecutionHistoryResult;
  stepDebugger?: UseStepDebuggerResult;
  debugHighlightLine?: number;
  breakpointLines?: number[];
  onToggleBreakpoint?: (line: number) => void;
  breakpoints?: UseBreakpointsResult;
}

export default function RightPanel({
  activeTestTab,
  setActiveTestTab,
  problemData,
  splitPosition,
  setUserAnswer,
  userAnswer,
  contentIndex,
  module = undefined,
  handleSubmitCode,
  submissionLoading,
  autoSaveKey,
  onAutoSave,
  signalsTracker,
  onAllTestsPassed,
  syntaxError,
  isValidating,
  executionHistory,
  stepDebugger,
  debugHighlightLine,
  breakpointLines,
  onToggleBreakpoint,
  breakpoints: bpState,
}: RightPanelProps) {
  // Keep a ref to the latest userAnswer so the content getter always returns current state
  const userAnswerRef = useRef(userAnswer);
  userAnswerRef.current = userAnswer;

  // Initialize diff tracking and attempt session for this problem
  useEffect(() => {
    const problemId = problemData?.questionNumber != null
      ? String(problemData.questionNumber)
      : undefined;
    if (!problemId) return;

    setTrackingContext({ problemId });
    setContentGetter(() => {
      const map = new Map<string, string>();
      map.set("solution.py", userAnswerRef.current ?? "");
      return map;
    });
    startDiffTracking();
    startAttemptSession({ problemId });

    return () => {
      cleanupDiffTracking();
      cleanupAttemptSession();
    };
  }, [problemData?.questionNumber]);

  return (
    <div
      className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden"
      style={{ width: `${100 - splitPosition}%` }}
    >
      {/* Editor section - grows to fill available space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeEditor
          value={userAnswer ?? problemData?.codeSnippet ?? ""}
          language="python"
          onChange={(value) => {
            const content = value ?? "";
            setUserAnswer(content);
            const problemId = problemData?.questionNumber != null ? String(problemData.questionNumber) : "";
            if (problemId) updateLiveContent(problemId, "solution.py", content);
          }}
          autoSaveKey={autoSaveKey}
          onAutoSave={onAutoSave}
          signalsTracker={signalsTracker}
          highlightLine={debugHighlightLine}
          breakpointLines={breakpointLines}
          onToggleBreakpoint={onToggleBreakpoint}
        />
      </div>

      {/* Test results panel - fixed at bottom */}
      <div className="flex-none">
        <TestResultsPanel
          mode="problem"
          problemData={problemData}
          userAnswer={userAnswer}
          contentIndex={contentIndex}
          module={module}
          activeTestTab={activeTestTab}
          setActiveTestTab={setActiveTestTab}
          handleSubmitCode={handleSubmitCode}
          submissionLoading={submissionLoading}
          signalsTracker={signalsTracker}
          onAllTestsPassed={onAllTestsPassed}
          executionHistory={executionHistory}
          stepDebugger={stepDebugger}
          breakpoints={bpState}
        />
      </div>
    </div>
  );
}
