"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TestCasesList } from "../ProblemPageRevamped/TestCasesList";
import TestResultsPanelHeader from "../ProblemPageRevamped/TestResultsPanelHeader";
import { runTestCases, runModuleTestCases, type TestRunResult } from "../ProblemPageRevamped/action";
import { runProjectTestCases, type ProjectTestRunResult } from "./projectActions";
import { parseUnittestFile } from "./projectTestRunner";
import { QuestionData, ProjectData, TestCase } from "../CodeEditor/types";
import { TestResult } from "../ProblemPageRevamped/models";
import { Module } from "@/components/Admin/modules/ModuleList";
import { toast } from "sonner";
import { ResultBadge } from "../ProblemPageRevamped/ResultBadge";
import { Button } from "@/components/ui/button";
import { EditorSignalsTracker } from "@/lib/editorSignals";
import { mapPythonError } from "@/lib/errorCodeMapper";
import { trackTelemetry } from "@/lib/telemetryClient";
import { logCodeAction } from "@/lib/actionLogger";
import {
  endAttemptSession,
  getSessionState,
  recordRunOutcome,
  startAttemptSession,
} from "@/lib/attemptSession";
import { recordRerunSameTest } from "@/lib/debuggingSignals";
import { initProfileNanoFromUserGesture } from "@/lib/profileNanoEditor";
import type { DavidSessionSummaryPayload } from "@/lib/verificationAgent";

import { VizPayloadV1 } from "@/lib/vizPayload";
import { vizPayloadToMermaidSource } from "@/lib/mermaidViz";
import { fireDecisionTraceEvent } from "@/lib/decisionTraceClient";
import { FEATURE_MERMAID_DEBUGGER, FEATURE_STEP_DEBUGGER } from "@/lib/flags";
import { DebugPanel } from "../Debugger/DebugPanel";
import { UseExecutionHistoryResult } from "@/hooks/useExecutionHistory";
import { UseStepDebuggerResult } from "@/hooks/useStepDebugger";
import { UseBreakpointsResult } from "@/hooks/useBreakpoints";
import { OutputPanel } from "./OutputPanel";
import { DebugTestSelector } from "../Debugger/DebugTestSelector";
import { useVerificationAgent } from "@/hooks/useVerificationAgent";
import { VerificationArtifact } from "../VerificationArtifact";
import { SessionStats } from "@/hooks/useSessionStats";

/** Common props for both problem and project modes */
interface BaseTestResultsPanelProps {
  activeTestTab: string;
  setActiveTestTab: (tab: string) => void;
  handleSubmitCode: () => void;
  submissionLoading: boolean;
  signalsTracker?: EditorSignalsTracker;
  /** Execution history from continuous shadow runner (for trace timeline) */
  executionHistory?: UseExecutionHistoryResult;
  /** Step debugger state (from useStepDebugger hook) */
  stepDebugger?: UseStepDebuggerResult;
  /** Breakpoints state for Continue functionality. */
  breakpoints?: UseBreakpointsResult;
  /** Navigate editor to a call stack frame's file + line. */
  onNavigateFrame?: (file: string, line: number) => void;
  sessionStats?: SessionStats;
  onRecordMentalModelMatch?: () => void;
  onRecordMentalModelMismatch?: () => void;
}

/** Problem page: single editor, official test cases from API */
export interface ProblemTestResultsPanelProps extends BaseTestResultsPanelProps {
  mode: "problem";
  problemData: QuestionData | null;
  userAnswer: string | null;
  contentIndex: number | null;
  module: Module | undefined;
  /** Called when user submits and passes all test cases */
  onAllTestsPassed?: () => void;
}

/** Project page: multi-file, official tests from unittest file + user tests */
export interface ProjectTestResultsPanelProps extends BaseTestResultsPanelProps {
  mode: "project";
  projectData: ProjectData | null;
  files: Record<string, string>;
  userTestsCode?: string;
  /** Callback to update user tests code (e.g. when boss fight adds a test) */
  onUserTestsCodeChange?: (code: string) => void;
  onSubmissionSuccess?: () => void;
  /** External visualization payload (from parent) */
  externalVizPayload?: VizPayloadV1 | null;
  /** Setter for external visualization payload */
  setExternalVizPayload?: (payload: VizPayloadV1 | null) => void;
  /** Callback to switch editor to the user tests file tab */
  onGoToUserTests?: () => void;
}

export type TestResultsPanelProps = ProblemTestResultsPanelProps | ProjectTestResultsPanelProps;

const MIN_PANEL_HEIGHT = 0;
const DEFAULT_PANEL_HEIGHT = 260;
const AUTO_COLLAPSE_THRESHOLD = 20;
const VIEWPORT_HEIGHT_PERCENT = 0.95;
const TEST_ITEM_HEIGHT = 65;
const HEADER_FOOTER_HEIGHT = 120;
const BUFFER_SPACE = 40;

function calculateDynamicMaxHeight(officialCount: number, userTestCount: number = 0): number {
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 1080;
  const viewportMaxHeight = viewportHeight * VIEWPORT_HEIGHT_PERCENT;
  const total = officialCount + userTestCount;
  const contentHeight = HEADER_FOOTER_HEIGHT + total * TEST_ITEM_HEIGHT + BUFFER_SPACE;
  // return Math.min(viewportMaxHeight, contentHeight);
  return viewportMaxHeight;
}

function transformUserTestToTestResult(userTest: any): TestResult {
  const errorInfo = mapPythonError(
    userTest.status as "pass" | "fail" | "error",
    userTest.error
  );
  return {
    name: userTest.name,
    expected: "Pass",
    actual:
      userTest.status === "pass" ? "Pass" : userTest.status === "fail" ? "Fail" : "Error",
    passed: userTest.status === "pass",
    printed: userTest.error || (userTest.status === "pass" ? "Test passed" : ""),
    errorCode: errorInfo.code,
    errorTooltip: errorInfo.tooltip,
  };
}

function createMockUserTestCase(userTest: any, index: number): TestCase {
  return {
    ID: index,
    Name: userTest.name,
    QuestionNumber: 0,
    input: "User-defined",
    expected_output: "Pass",
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
  };
}

function mergeTestResults(oldResults: TestResult[], newResults: TestResult[]): TestResult[] {
  const keyOf = (r: TestResult & { rawName?: string }) => r.rawName ?? r.name;
  const map = new Map<string, TestResult>();
  oldResults.forEach((r) => map.set(keyOf(r as any), r));
  newResults.forEach((r) => map.set(keyOf(r as any), r));
  return Array.from(map.values());
}

function EmptyUserTestsState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-4xl mb-4">📝</div>
      <h3 className="text-lg font-semibold text-gray-200 mb-2">No User Tests Run Yet</h3>
      <p className="text-sm text-gray-400 mb-4 max-w-md">
        Write your own tests in the &ldquo;My Tests&rdquo; file tab, then click
        &ldquo;Run All Tests&rdquo; to execute them alongside the official tests.
      </p>
      <div className="bg-[#1e2d3d] border border-[#2e3d4d] rounded-lg p-4 text-left max-w-md">
        <p className="text-xs text-gray-300 mb-2 font-semibold">Quick Start:</p>
        <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
          <li>Switch to the &ldquo;My Tests&rdquo; tab in the editor</li>
          <li>Write Python test functions</li>
          <li>Add them to the USER_TESTS list</li>
          <li>Click &ldquo;Run All Tests&rdquo; to execute</li>
        </ol>
      </div>
    </div>
  );
}

/** Build error snippet for session artifact: stderr, or failed test messages when running full suite */
function buildRunErrorSnippet(result: {
  stderr?: string;
  testResults?: TestResult[];
}): string {
  const stderr = (result.stderr ?? "").trim();
  if (stderr) return stderr.slice(0, 500);
  const failed = result.testResults?.filter((r) => !r.passed).map((r) => r.printed).filter(Boolean) ?? [];
  if (failed.length === 0) return "";
  return failed.join("\n").slice(0, 500);
}

/** Build runResult metadata and record outcome for session metrics */
function recordRunAndLog(
  type: "run_code_click" | "run_test_case_click" | "submit_click",
  target: string,
  baseMeta: Record<string, unknown>,
  result: { testResults: TestResult[]; stderr?: string; errorSnippet?: string }
) {
  const passed = result.testResults.every((r) => r.passed) && result.testResults.length > 0;
  const testsPassed = result.testResults.filter((r) => r.passed).length;
  const testsTotal = result.testResults.length;
  const errorSnippet = result.errorSnippet ?? buildRunErrorSnippet(result);
  const snippetForStorage = errorSnippet.slice(0, 200);
  const stderr = result.stderr ?? "";
  const compileSuccess = !stderr.toLowerCase().includes("syntaxerror");
  const sessionState = getSessionState();
  const activeSecondsAtRun = sessionState?.activeSeconds ?? 0;
  const firstRunInSession = (sessionState?.runOutcomes.length ?? 0) === 0;

  recordRunOutcome({
    timestamp: Date.now(),
    activeSecondsAtRun,
    passed,
    testsPassed,
    testsTotal,
    compileSuccess,
    errorSnippet: snippetForStorage,
    firstRunInSession,
    testCases: result.testResults.map((t) => ({
      id: t.name,
      name: t.name,
      passed: t.passed,
    })),
  });

  logCodeAction(type, target, {
    ...baseMeta,
    runResult: {
      passed,
      testsPassed,
      testsTotal,
      compileSuccess,
      errorSnippet: snippetForStorage,
      firstRunInSession,
    },
  });
}
/**
 * Unified test results panel (canonical implementation).
 * Supports both problem (single editor, API test cases) and project (multi-file, unittest + user tests) modes.
 */
export const TestResultsPanel: React.FC<TestResultsPanelProps> = (props) => {
  const {
    mode,
    activeTestTab,
    setActiveTestTab,
    handleSubmitCode,
    submissionLoading,
    signalsTracker,
    executionHistory,
    stepDebugger,
    breakpoints: bpState,
    onNavigateFrame,
    sessionStats,
    onRecordMentalModelMatch,
    onRecordMentalModelMismatch,
  } = props;

  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [activeTestCaseNumber, setActiveTestCaseNumber] = useState<number | null>(null);
  const [activeUserTestCaseNumber, setActiveUserTestCaseNumber] = useState<number | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [resultMode, setResultMode] = useState<"local" | "server" | "verifying" | null>(null);
  const [userTestsResults, setUserTestsResults] = useState<any[]>([]);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string>("");

  // Visualization state (internal or external)
  const [internalVizPayload, setInternalVizPayload] = useState<VizPayloadV1 | null>(null);
  /** AI-generated Mermaid source from last Submit (project only); guarantees AI runs on every Submit */
  const [submittedMermaidSource, setSubmittedMermaidSource] = useState<string | null>(null);

  // Verification Agent — monitors thrashing and triggers Cognitive Mirror
  const verificationAgent = useVerificationAgent();

  const vizPayload = (mode === "project" && (props as ProjectTestResultsPanelProps).externalVizPayload !== undefined)
    ? (props as ProjectTestResultsPanelProps).externalVizPayload
    : internalVizPayload;

  const setVizPayload = (payload: VizPayloadV1 | null) => {
    if (mode === "project" && (props as ProjectTestResultsPanelProps).setExternalVizPayload) {
      (props as ProjectTestResultsPanelProps).setExternalVizPayload!(payload);
    } else {
      setInternalVizPayload(payload);
    }
  };

  const lastKnownHeightRef = useRef(DEFAULT_PANEL_HEIGHT);
  const isDraggingRef = useRef(false);
  const dragSnapshotRef = useRef({ startY: 0, startHeight: DEFAULT_PANEL_HEIGHT });
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  // Official test cases: problem = from API, project = from unittest file
  const problemData = mode === "problem" ? (props as ProblemTestResultsPanelProps).problemData : null;
  const projectData = mode === "project" ? (props as ProjectTestResultsPanelProps).projectData : null;
  const officialTestCases: TestCase[] = useMemo(() => {
    if (mode === "problem") {
      return problemData?.testcases ?? [];
    }
    if (!projectData) return [];
    const { testNames } = parseUnittestFile(projectData.testFile.content);
    return testNames.map((name, idx) => ({
      ID: idx,
      Name: name.replace("test_", "").replace(/_/g, " "),
      QuestionNumber: 0,
      input: "N/A",
      expected_output: "Pass",
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    }));
  }, [mode, problemData, projectData]);

  const userTestResults: TestResult[] = useMemo(
    () => userTestsResults.map(transformUserTestToTestResult),
    [userTestsResults]
  );
  const mockUserTestCases: TestCase[] = useMemo(
    () => userTestsResults.map((test, idx) => createMockUserTestCase(test, idx)),
    [userTestsResults]
  );

  const codeForTrace = useMemo(() => {
    if (mode === "problem") return (props as ProblemTestResultsPanelProps).userAnswer ?? "";
    const pProps = props as ProjectTestResultsPanelProps;
    let combined = Object.entries(pProps.files || {}).map(([name, content]) => `### File: ${name}\n${content}`).join("\n\n");
    if (pProps.userTestsCode) {
      combined += `\n\n### File: USER_TESTS.py\n${pProps.userTestsCode}`;
    }
    return combined;
  }, [mode, props]);

  const testCaseCount = officialTestCases.length;
  const userTestCount = mode === "project" ? mockUserTestCases.length : 0;
  const getDynamicMaxHeight = useCallback(
    () => calculateDynamicMaxHeight(testCaseCount, userTestCount),
    [testCaseCount, userTestCount]
  );
  const clampPanelHeight = useCallback(
    (value: number) => {
      const maxHeight = getDynamicMaxHeight();
      return Math.min(Math.max(value, MIN_PANEL_HEIGHT), maxHeight);
    },
    [getDynamicMaxHeight]
  );
  const rememberHeight = useCallback(
    (nextHeight: number) => {
      const safeHeight = clampPanelHeight(nextHeight);
      lastKnownHeightRef.current = safeHeight;
      setPanelHeight(safeHeight);
    },
    [clampPanelHeight]
  );
  const ensureExpanded = useCallback(() => {
    setIsCollapsed(false);
    rememberHeight(lastKnownHeightRef.current || DEFAULT_PANEL_HEIGHT);
  }, [rememberHeight]);
  const startResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      // When starting from collapsed, begin at 0 height so drag smoothly expands
      // When starting from expanded, begin at current height
      const baseHeight = isCollapsed ? 0 : panelHeight;

      if (isCollapsed) {
        // Make panel visible (but at 0 height initially)
        setIsCollapsed(false);
        setPanelHeight(0);
      }

      dragSnapshotRef.current = { startY: event.clientY, startHeight: baseHeight };
      isDraggingRef.current = true;
      document.body.style.cursor = "row-resize";
    },
    [isCollapsed, panelHeight]
  );
  const toggleCollapse = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
      rememberHeight(lastKnownHeightRef.current);
      return;
    }
    lastKnownHeightRef.current = clampPanelHeight(panelHeight);
    setIsCollapsed(true);
  }, [isCollapsed, panelHeight, rememberHeight, clampPanelHeight]);

  const contentHeight = isCollapsed ? 0 : panelHeight;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const { startY, startHeight } = dragSnapshotRef.current;
      const delta = startY - event.clientY;
      const newHeight = startHeight + delta;
      if (
        newHeight < AUTO_COLLAPSE_THRESHOLD &&
        startHeight >= AUTO_COLLAPSE_THRESHOLD
      ) {
        lastKnownHeightRef.current = clampPanelHeight(startHeight);
        setIsCollapsed(true);
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        return;
      }
      rememberHeight(newHeight);
    };
    const endResize = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", endResize);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", endResize);
      if (isDraggingRef.current) {
        document.body.style.cursor = "";
        isDraggingRef.current = false;
      }
    };
  }, [rememberHeight, clampPanelHeight]);

  useEffect(() => {
    const container = panelBodyRef.current;
    if (!container) return;
    container.style.height = `${Math.max(contentHeight, 0)}px`;
    container.style.opacity = isCollapsed ? "0" : "1";
  }, [contentHeight, isCollapsed]);

  useEffect(() => {
    const handleResize = () => {
      const currentHeight = panelHeight;
      const newMaxHeight = getDynamicMaxHeight();
      if (currentHeight > newMaxHeight) rememberHeight(newMaxHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [panelHeight, getDynamicMaxHeight, rememberHeight]);

  // Track offer shown when payload arrives
  useEffect(() => {
    if (vizPayload?.viz && vizPayload.vizEligible) {
      trackTelemetry("viz_offer_shown", {
        testName: vizPayload.testName,
        errorCode: vizPayload.errorCode,
        diagramType: vizPayload.viz.diagramType
      });
    }
  }, [vizPayload]);

  // Record run events to the Verification Agent whenever test results update
  const lastRecordedResultsRef = useRef<TestResult[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<{
    thrashScore: number;
    convergenceRate: number;
    runCount: number;
  } | null>(null);

  useEffect(() => {
    if (testResults.length > 0 && testResults !== lastRecordedResultsRef.current) {
      lastRecordedResultsRef.current = testResults;

      // Build DavidSessionSummaryPayload from David's attemptSession state
      let davidSummary: DavidSessionSummaryPayload | null = null;
      const sessionState = getSessionState();
      if (sessionState && sessionState.runOutcomes.length > 0) {
        // Compute iteration metrics inline (simplified version of attemptSession logic)
        const runs = sessionState.runOutcomes;
        const passIndex = runs.findIndex(
          (r) => r.passed && r.testsTotal != null && r.testsTotal > 0 && r.testsPassed === r.testsTotal
        );
        const iterationsToPass = passIndex >= 0 ? passIndex + 1 : runs.length;

        // Compute thrash score from failure patterns
        let regressions = 0;
        let noImprovement = 0;
        for (let i = 1; i < runs.length; i++) {
          const prevFailed = (runs[i - 1].testsTotal ?? 0) - (runs[i - 1].testsPassed ?? 0);
          const currFailed = (runs[i].testsTotal ?? 0) - (runs[i].testsPassed ?? 0);
          if (currFailed > prevFailed) regressions++;
          else if (currFailed === prevFailed && currFailed > 0) noImprovement++;
        }
        const thrashScore = runs.length > 1 ? (regressions + noImprovement) / (runs.length - 1) : 0;

        // Convergence rate: fraction of runs with at least some tests passing
        const runsWithProgress = runs.filter((r) => (r.testsPassed ?? 0) > 0).length;
        const convergenceRate = runs.length > 0 ? runsWithProgress / runs.length : 0;

        // Update session metrics for DebugPanel
        setSessionMetrics({
          thrashScore,
          convergenceRate,
          runCount: runs.length,
        });

        davidSummary = {
          summary: {
            runCount: runs.length,
            iteration: {
              thrashScore,
              convergenceRate,
              iterationsToPass,
              classification: thrashScore > 0.5 ? "thrashing" : "convergent",
            },
          },
        };
      }

      verificationAgent.recordRun(codeForTrace, testResults, vizPayload ?? null, davidSummary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testResults]);

  function ensureAttemptSession(): void {
    if (getSessionState()) return;
    if (mode === "problem") {
      const { problemData, module, contentIndex } = props as ProblemTestResultsPanelProps;
      const problemId =
        problemData?.questionNumber != null
          ? String(problemData.questionNumber)
          : module?.ID != null
            ? `module_${module.ID}_${contentIndex ?? "unknown"}`
            : undefined;
      if (problemId) startAttemptSession({ problemId });
      return;
    }
    const { projectData } = props as ProjectTestResultsPanelProps;
    if (projectData?.id) startAttemptSession({ projectId: projectData.id });
  }

  // ---- Run handlers: branch on mode ----
  async function runIndividualTestCase(testCaseNumber: number) {
    const startTime = performance.now();
    signalsTracker?.markRunClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();
    const hadFailedBefore = testResults[testCaseNumber]?.passed === false;
    if (hadFailedBefore) recordRerunSameTest(testCaseNumber);

    setActiveTestCaseNumber(testCaseNumber);
    setRunningAll(false);
    setResultMode("local");

    try {
      // Capture fresh results for profile update (avoid reading stale React state)
      let latestProblemResult: TestResult[] | null = null;
      let latestProjectResult: ProjectTestRunResult | null = null;

      if (mode === "problem") {
        const { problemData, userAnswer, contentIndex, module } = props;
        if (module !== undefined) {
          const { testResults: newResults, consoleOutput: output } = await runModuleTestCases(
            module?.ID ?? "",
            userAnswer ?? "",
            71,
            testCaseNumber,
            false,
            contentIndex ?? -1,
            false
          );
          latestProblemResult = newResults;
          recordRunAndLog("run_test_case_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            testCaseNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          setTestResults((prev) => mergeTestResults(prev, newResults));
          setConsoleOutput(output);
        } else {
          const { testResults: newResults, consoleOutput: output } = await runTestCases(
            `${problemData?.questionNumber}`,
            userAnswer ?? "",
            71,
            testCaseNumber,
            false,
            false
          );
          latestProblemResult = newResults;
          recordRunAndLog("run_test_case_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            testCaseNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          setTestResults((prev) => mergeTestResults(prev, newResults));
          setConsoleOutput(output);
        }
        trackTelemetry("runner_total_latency", {
          ttfr_ms: performance.now() - startTime,
          problem_id: problemData?.questionNumber,
          mode: "individual",
          test_case: testCaseNumber,
        });
      } else {
        const { projectData, files, userTestsCode = "" } = props;
        if (!projectData) return;
        const result = await runProjectTestCases(
          projectData,
          files,
          testCaseNumber,
          false,
          false,
          userTestsCode
        );
        latestProjectResult = result;
        recordRunAndLog("run_test_case_click", projectData.id, {
          projectId: projectData.id,
          testCaseNumber,
          submittedCode: files,
          userTestsCode: userTestsCode || undefined,
        }, result);
        setTestResults((prev) => mergeTestResults(prev, result.testResults));
        setUserTestsResults(result.userTestsResults ?? []);
        setConsoleOutput(result.consoleOutput ?? "");

        // Handle visualization payload (user-triggered: show "View structure" button, don't auto-switch)
        if (result.vizPayload && FEATURE_MERMAID_DEBUGGER) {
          setVizPayload(result.vizPayload);
          setSubmittedMermaidSource(null);
        } else {
          setVizPayload(null);
          setSubmittedMermaidSource(null);
        }

        trackTelemetry("runner_total_latency", {
          ttfr_ms: performance.now() - startTime,
          project_id: projectData.id,
          mode: "individual",
          test_case: testCaseNumber,
          context: "project",
        });
      }
    } catch (err) {
      toast.error("There was a problem running the test case.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
    }
  }

  async function runIndividualUserTest(testCaseNumber: number) {
    if (mode !== "project" || testCaseNumber < 0 || testCaseNumber >= userTestsResults.length)
      return;
    const { projectData, files, userTestsCode = "" } = props;
    if (!projectData) return;

    setActiveUserTestCaseNumber(testCaseNumber);
    setRunningAll(false);
    setResultMode("local");
    ensureExpanded();
    setActiveTestTab("user-tests");

    try {
      const testToRun = userTestsResults[testCaseNumber];
      const result = await runProjectTestCases(
        projectData,
        files,
        -1,
        false,
        false,
        userTestsCode
      );
      setUserTestsResults(result.userTestsResults ?? []);
      setConsoleOutput(result.consoleOutput ?? "");
      const specific = result.userTestsResults?.find((t) => t.name === testToRun.name);
      if (specific?.status === "pass") {
        toast.success(`User test "${testToRun.name}" passed!`);
      } else {
        toast.error(`User test "${testToRun.name}" failed`);
      }
    } catch (err) {
      toast.error("There was a problem running the user test.");
      setResultMode(null);
    } finally {
      setActiveUserTestCaseNumber(null);
    }
  }

  async function runAllTestCases() {
    const startTime = performance.now();
    signalsTracker?.markRunClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();

    ensureExpanded();
    setRunningAll(true);
    setActiveTestCaseNumber(-1);
    setResultMode("local");

    try {
      if (mode === "problem") {
        const { problemData, userAnswer, contentIndex, module } = props;
        if (module !== undefined) {
          const { testResults: newResults, consoleOutput: output } = await runModuleTestCases(
            module?.ID ?? "",
            userAnswer ?? "",
            71,
            -1,
            true,
            contentIndex ?? -1,
            false
          );
          recordRunAndLog("run_code_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          const next = mergeTestResults(testResults, newResults);
          setTestResults(next);
          setConsoleOutput(output);
          const allPassed = next.every((r) => r.passed);
          if (!allPassed && next.some((r) => !r.passed) && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
            setActiveTestTab("diagnostics");
          }
          if (allPassed && next.length > 0) toast.success(`🎉 All ${next.length} tests passed!`);
          else toast.error(`${next.filter((r) => r.passed).length}/${next.length} tests passed`);
        } else {
          const { testResults: newResults, consoleOutput: output } = await runTestCases(
            `${problemData?.questionNumber}`,
            userAnswer ?? "",
            71,
            1,
            true,
            false
          );
          recordRunAndLog("run_code_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          const next = mergeTestResults(testResults, newResults);
          setTestResults(next);
          setConsoleOutput(output);
          const allPassed = next.every((r) => r.passed);
          if (!allPassed && next.some((r) => !r.passed) && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
            setActiveTestTab("diagnostics");
          }
          if (allPassed && next.length > 0)
            toast.success(`🎉 All ${next.length} tests passed! Problem solved!`);
          else toast.error(`${next.filter((r) => r.passed).length}/${next.length} tests passed`);
        }
        trackTelemetry("runner_total_latency", {
          ttfr_ms: performance.now() - startTime,
          problem_id: props.problemData?.questionNumber,
          mode: "all",
        });
      } else {
        const { projectData, files, userTestsCode = "" } = props;
        if (!projectData) return;
        const result = await runProjectTestCases(
          projectData,
          files,
          -1,
          true,
          false,
          userTestsCode
        );
        recordRunAndLog("run_code_click", projectData.id, {
          projectId: projectData.id,
          submittedCode: files,
          userTestsCode: userTestsCode || undefined,
        }, result);
        setTestResults(result.testResults);
        setUserTestsResults(result.userTestsResults ?? []);
        setConsoleOutput(result.consoleOutput ?? "");

        // Handle visualization payload; on failure auto-switch to Diagnostics
        if (result.vizPayload && FEATURE_MERMAID_DEBUGGER) {
          setVizPayload(result.vizPayload);
          setSubmittedMermaidSource(null);
        } else {
          setVizPayload(null);
          setSubmittedMermaidSource(null);
        }
        const hasFailures = result.testResults.some((r) => !r.passed);
        if (hasFailures && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
          setActiveTestTab("diagnostics");
        }

        const allPassed = result.testResults.every((r) => r.passed);
        if (allPassed && result.testResults.length > 0)
          toast.success(`🎉 All ${result.testResults.length} tests passed!`);
        else
          toast.error(
            `${result.testResults.filter((r) => r.passed).length}/${result.testResults.length} tests passed`
          );
        trackTelemetry("runner_total_latency", {
          ttfr_ms: performance.now() - startTime,
          project_id: projectData.id,
          mode: "all",
          context: "project",
        });
      }

    } catch (err) {
      toast.error("There was a problem running all test cases.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
      setRunningAll(false);
    }
  }

  async function submitCode() {
    const submitStartTime = performance.now();
    signalsTracker?.markSubmitClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();

    ensureExpanded();
    setActiveTestTab("tests");
    setRunningAll(true);
    setActiveTestCaseNumber(-1);
    setResultMode("local");
    const signals = signalsTracker?.snapshot();

    try {
      if (mode === "problem") {
        const { problemData, userAnswer, contentIndex, module, onAllTestsPassed } = props;
        if (module !== undefined) {
          const { testResults: newResults, consoleOutput: output } = await runModuleTestCases(
            module?.ID ?? "",
            userAnswer ?? "",
            71,
            -1,
            true,
            contentIndex ?? -1,
            true,
            signals
          );
          recordRunAndLog("submit_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          await endAttemptSession("submit");
          const next = mergeTestResults(testResults, newResults);
          setTestResults(next);
          setConsoleOutput(output);
          const passed = next.filter((r) => r.passed).length;
          const allPassed = next.every((r) => r.passed) && next.length > 0;

          fireDecisionTraceEvent({
            eventType: "SUBMIT",
            contentType: "module_problem",
            contentId: module?.ID ?? "",
            language: "python",
            codeText: userAnswer ?? "",
            testResults: next,
            consoleOutput: output,
            stats: sessionStats,
          }).catch((e) => console.error("[TestResultsPanel] DT event fire-and-forget error:", e));

          if (allPassed) {
            toast.success(`🎉 Submitted! All ${next.length} tests passed!`);
            onAllTestsPassed?.();
          } else {
            // if (next.some((r) => !r.passed) && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
            //   setActiveTestTab("diagnostics");
            // }
            toast.info(`Submitted: ${passed}/${next.length} tests passed`);
          }

        } else {
          const { testResults: newResults, consoleOutput: output } = await runTestCases(
            `${problemData?.questionNumber}`,
            userAnswer ?? "",
            71,
            1,
            true,
            true,
            signals
          );
          recordRunAndLog("submit_click", String(problemData?.questionNumber ?? "unknown"), {
            problemId: problemData?.questionNumber,
            submittedCode: userAnswer,
          }, { testResults: newResults });
          await endAttemptSession("submit");
          const next = mergeTestResults(testResults, newResults);
          setTestResults(next);
          setConsoleOutput(output);
          const passed = next.filter((r) => r.passed).length;
          const allPassed = next.every((r) => r.passed) && next.length > 0;

          fireDecisionTraceEvent({
            eventType: "SUBMIT",
            contentType: "problem",
            contentId: `${problemData?.questionNumber}`,
            language: "python",
            codeText: userAnswer ?? "",
            testResults: next,
            consoleOutput: output,
          }).catch((e) => console.error("[TestResultsPanel] DT event fire-and-forget error:", e));

          if (allPassed) {
            toast.success(`🎉 Submitted! All ${next.length} tests passed! Problem solved!`);
            onAllTestsPassed?.();
          } else {
            // if (next.some((r) => !r.passed) && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
            //   setActiveTestTab("diagnostics");
            // }
            toast.info(`Submitted: ${passed}/${next.length} tests passed`);
          }

        }
      } else {
        const { projectData, files, userTestsCode = "", onSubmissionSuccess } = props;
        if (!projectData) return;
        const result = await runProjectTestCases(
          projectData,
          files,
          -1,
          true,
          true,
          userTestsCode,
          signals
        );
        recordRunAndLog("submit_click", projectData.id, {
          projectId: projectData.id,
          submittedCode: files,
          userTestsCode: userTestsCode || undefined,
        }, result);
        await endAttemptSession("submit");
        setTestResults(result.testResults);
        setUserTestsResults(result.userTestsResults ?? []);
        setConsoleOutput(result.consoleOutput ?? "");

        // Handle visualization payload (user-triggered: show "View structure" button, don't auto-switch)
        if (result.vizPayload && FEATURE_MERMAID_DEBUGGER) {
          setVizPayload(result.vizPayload);
          setSubmittedMermaidSource(null);
          try {
            const mermaidSource = await vizPayloadToMermaidSource(result.vizPayload.viz!);
            setSubmittedMermaidSource(mermaidSource);
            fireDecisionTraceEvent({
              eventType: "SUBMIT",
              contentType: "project",
              contentId: projectData.id,
              language: "python",
              codeText: Object.entries(files)
                .map(([name, content]) => `### File: ${name}\n${content}`)
                .join("\n\n"),
              testResults: result.testResults,
              consoleOutput: result.consoleOutput ?? "",
              vizPayload: result.vizPayload,
              mermaidSource,
            }).catch((e) => console.error("[TestResultsPanel] DT event fire-and-forget error:", e));
          } catch (e) {
            console.error("[TestResultsPanel] AI viz generation on Submit failed:", e);
            setSubmittedMermaidSource(null);
            fireDecisionTraceEvent({
              eventType: "SUBMIT",
              contentType: "project",
              contentId: projectData.id,
              language: "python",
              codeText: Object.entries(files)
                .map(([name, content]) => `### File: ${name}\n${content}`)
                .join("\n\n"),
              testResults: result.testResults,
              consoleOutput: result.consoleOutput ?? "",
              vizPayload: result.vizPayload,
            }).catch((err) => console.error("[TestResultsPanel] DT event fire-and-forget error:", err));
          }
        } else {
          setSubmittedMermaidSource(null);
          if (result.testResults.length > 0) {
            fireDecisionTraceEvent({
              eventType: "SUBMIT",
              contentType: "project",
              contentId: projectData.id,
              language: "python",
              codeText: Object.entries(files)
                .map(([name, content]) => `### File: ${name}\n${content}`)
                .join("\n\n"),
              testResults: result.testResults,
              consoleOutput: result.consoleOutput ?? "",
            }).catch((e) => console.error("[TestResultsPanel] DT event fire-and-forget error:", e));
          }
        }

        const passed = result.testResults.filter((r) => r.passed).length;
        const allPassed = result.testResults.every((r) => r.passed) && result.testResults.length > 0;
        const hasFailures = result.testResults.some((r) => !r.passed);
        // if (hasFailures && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER)) {
        //   setActiveTestTab("diagnostics");
        // }
        if (allPassed) {
          toast.success(`🎉 Submitted! All ${result.testResults.length} tests passed!`);
          onSubmissionSuccess?.();
        } else {
          toast.info(`Submitted: ${passed}/${result.testResults.length} tests passed`);
        }

      }
    } catch (err) {
      toast.error("There was a problem submitting your code.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
      setRunningAll(false);
    }
  }

  const panelId = mode === "problem" ? "problem-test-results-body" : "project-test-results-body";
  const failureCount = testResults.filter((r) => !r.passed).length;
  const showDiagnosticsTab =
    failureCount > 0 && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER);
  const showDiagnosticsForVerification =
    showDiagnosticsTab || verificationAgent.reportCard !== null || verificationAgent.isAnalyzing;

  function handleDebug() {
    setActiveTestTab("diagnostics");
    ensureExpanded();
    // Don't auto-start trace -- user picks a test in DebugTestSelector first
  }

  /** Start a step-through debug trace for a specific test (called by DebugTestSelector). */
  function handleStartDebugForTest(_testName: string) {
    if (!FEATURE_STEP_DEBUGGER || !stepDebugger || stepDebugger.isTracing) return;

    if (mode === "project") {
      const pProps = props as ProjectTestResultsPanelProps;
      const allFiles = { ...pProps.files };
      if (pProps.projectData?.testFile) {
        allFiles[pProps.projectData.testFile.filename] = pProps.projectData.testFile.content;
      }
      const entryFile = pProps.projectData
        ? Object.keys(pProps.projectData.starterFiles)[0] || Object.keys(pProps.files)[0]
        : Object.keys(pProps.files)[0];
      if (entryFile) {
        stepDebugger.startDebugMulti(allFiles, entryFile);
      }
    } else {
      stepDebugger.startDebug(codeForTrace);
    }
  }

  return (
    <div ref={panelContainerRef} className="bg-primary flex flex-col">
      <div className="relative">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize test results panel"
          onMouseDown={startResize}
          className="absolute top-0 left-0 right-0 z-10 h-3 cursor-row-resize bg-transparent"
        />
        <TestResultsPanelHeader
          activeTestTab={activeTestTab}
          setActiveTestTab={setActiveTestTab}
          runAllTestCases={runAllTestCases}
          submitCode={submitCode}
          submissionLoading={submissionLoading}
          runningAll={runningAll}
          showDiagnosticsTab={showDiagnosticsForVerification}
          handleDebug={handleDebug}
          isDebugTracing={stepDebugger?.isTracing}
          debugStepIndex={stepDebugger?.isActive ? stepDebugger.stepIndex : undefined}
          debugTotalSteps={stepDebugger?.isActive ? stepDebugger.totalSteps : undefined}
          isCollapsed={isCollapsed}
          toggleCollapse={toggleCollapse}
          isVerificationAgentAnalyzing={verificationAgent.isAnalyzing}
        />
      </div>

      <div
        ref={panelBodyRef}
        id={panelId}
        className={`overflow-hidden ${isCollapsed ? "pointer-events-none" : "pointer-events-auto"}`}
        data-panel-state={isCollapsed ? "collapsed" : "expanded"}
      >
        <div className="h-full overflow-auto scrollbar-thin scrollbar-track scrollbar-thumb p-4">
          <Tabs value={activeTestTab} className="w-full">
            <TabsContent value="tests" className="m-0">
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-sm font-medium text-primaryTextColor">Test Cases</div>
                  <div className="flex items-center gap-2">
                    {showDiagnosticsTab && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActiveTestTab("diagnostics");
                          ensureExpanded();
                        }}
                        className="text-xs text-purple-400 border-purple-500/40 hover:bg-purple-500/10 hover:border-purple-500/60"
                      >
                        View structure
                      </Button>
                    )}
                    <ResultBadge mode={resultMode} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleCollapse}
                      className="text-xs text-gray-300 hover:text-white"
                      aria-expanded={!isCollapsed}
                      aria-controls={panelId}
                    >
                      {isCollapsed ? "Show results" : "Hide results"}
                    </Button>
                  </div>
                </div>
                <TestCasesList
                  testCases={officialTestCases}
                  testResults={testResults}
                  runIndividualTestCase={runIndividualTestCase}
                  activeTestCaseNumber={activeTestCaseNumber}
                  runningAll={submissionLoading || runningAll}
                  code={codeForTrace}
                />
              </div>
            </TabsContent>

            <TabsContent value="output" className="m-0">
              <OutputPanel
                testResults={testResults}
                consoleOutput={consoleOutput}
                isRunning={runningAll || submissionLoading}
              />
            </TabsContent>

            {showDiagnosticsForVerification && (
              <TabsContent value="diagnostics" className="m-0 h-full">
                <div className="h-full border border-zinc-800 rounded-lg overflow-hidden">
                  {/* Verification Agent Artifact (shows when thrash detected) */}
                  {verificationAgent.reportCard && (
                    <div className="p-3">
                      <VerificationArtifact
                        onMatch={() => {
                          toast.success("Great! Keeping up the momentum.");
                          onRecordMentalModelMatch?.();
                        }}
                        onMismatch={() => {
                          toast.info("Noted. Adjusting mental model...");
                          onRecordMentalModelMismatch?.();
                        }}
                        reportCard={verificationAgent.reportCard}
                        cognitiveShadow={verificationAgent.cognitiveShadow}
                        onDismiss={verificationAgent.dismiss}
                      />
                    </div>
                  )}

                  {/* Existing diagnostics content */}
                  {showDiagnosticsTab && (FEATURE_MERMAID_DEBUGGER || FEATURE_STEP_DEBUGGER) && (
                    <>
                      {stepDebugger?.isActive ? (
                        /* Active trace: show full step-through debugger */
                        <DebugPanel
                          vizPayload={vizPayload}
                          submittedMermaidSource={mode === "project" ? submittedMermaidSource : undefined}
                          executionHistory={executionHistory}
                          step={stepDebugger.step}
                          onStepOver={stepDebugger.onStepOver}
                          onRestart={stepDebugger.onRestart}
                          onStop={stepDebugger.onStop}
                          isFinished={stepDebugger.isFinished}
                          onContinue={bpState ? () => stepDebugger.onContinue(bpState.breakpoints) : undefined}
                          onNavigateFrame={onNavigateFrame}
                          sessionMetrics={sessionMetrics}
                        />
                      ) : FEATURE_STEP_DEBUGGER && stepDebugger ? (
                        /* No active trace: show test selector to pick a test and start debugging */
                        <DebugTestSelector
                          testResults={testResults}
                          officialTestCases={officialTestCases}
                          onStartDebug={handleStartDebugForTest}
                          isTracing={stepDebugger.isTracing}
                          hasRunTests={testResults.length > 0}
                        />
                      ) : (
                        /* Fallback: viz-only debug panel (no step debugger available) */
                        <DebugPanel
                          vizPayload={vizPayload}
                          submittedMermaidSource={mode === "project" ? submittedMermaidSource : undefined}
                          executionHistory={executionHistory}
                          sessionMetrics={sessionMetrics}
                        />
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
};
