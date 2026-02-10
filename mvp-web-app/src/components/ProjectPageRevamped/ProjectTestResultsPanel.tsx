"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import TestResultsPanelHeader from "../ProblemPageRevamped/TestResultsPanelHeader";
import { TestCasesList } from "../ProblemPageRevamped/TestCasesList";
import { runProjectTestCases } from "./projectActions";
import { parseUnittestFile } from "./projectTestRunner";
import { TestResult } from "../ProblemPageRevamped/models";
import { ProjectData, TestCase } from "../CodeEditor/types";
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

/**
 * Transform user test result from Python format to TestResult format
 */
function transformUserTestToTestResult(userTest: any): TestResult {
  // Map to universal error code
  const errorInfo = mapPythonError(
    userTest.status as 'pass' | 'fail' | 'error',
    userTest.error
  );
  
  return {
    name: userTest.name,
    expected: "Pass",
    actual: userTest.status === 'pass' ? "Pass" :
            userTest.status === 'fail' ? "Fail" : "Error",
    passed: userTest.status === 'pass',
    printed: userTest.error || (userTest.status === 'pass' ? "Test passed" : ""),
    errorCode: errorInfo.code,
    errorTooltip: errorInfo.tooltip
  };
}

/**
 * Create mock TestCase for a user test
 */
function createMockUserTestCase(userTest: any, index: number): TestCase {
  return {
    ID: index,
    Name: userTest.name,
    QuestionNumber: 0,
    input: "User-defined",
    expected_output: "Pass",
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  };
}

interface ProjectTestResultsPanelProps {
  projectData: ProjectData | null;
  activeTestTab: string;
  setActiveTestTab: (tab: string) => void;
  files: Record<string, string>;
  handleSubmitCode: () => void;
  submissionLoading: boolean;
  userTestsCode?: string;
  /** Editor signals tracker for run/submit event tracking */
  signalsTracker?: EditorSignalsTracker;
  /** Callback to refresh submissions list after successful submit */
  onSubmissionSuccess?: () => void;
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
  const errorSnippet =
    result.errorSnippet ?? buildRunErrorSnippet(result);
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

  const runResult = {
    passed,
    testsPassed,
    testsTotal,
    compileSuccess,
    errorSnippet: snippetForStorage,
    firstRunInSession,
  };
  logCodeAction(type, target, { ...baseMeta, runResult });
}

const MIN_PANEL_HEIGHT = 0;
const DEFAULT_PANEL_HEIGHT = 260;
const AUTO_COLLAPSE_THRESHOLD = 20; // Auto-collapse if dragged below this

// Dynamic height calculation constants
const VIEWPORT_HEIGHT_PERCENT = 0.80; // 80vh
const TEST_ITEM_HEIGHT = 65; // Per test item
const HEADER_FOOTER_HEIGHT = 120; // UI chrome
const BUFFER_SPACE = 40; // Prevent cut-off

/**
 * Calculate dynamic max height based on number of tests and viewport size
 */
function calculateDynamicMaxHeight(officialTestCount: number, userTestCount: number): number {
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const viewportMaxHeight = viewportHeight * VIEWPORT_HEIGHT_PERCENT;

  const totalTests = officialTestCount + userTestCount;
  const contentHeight = HEADER_FOOTER_HEIGHT + (totalTests * TEST_ITEM_HEIGHT) + BUFFER_SPACE;

  return Math.min(viewportMaxHeight, contentHeight);
}

export const ProjectTestResultsPanel: React.FC<ProjectTestResultsPanelProps> = ({
  projectData,
  activeTestTab,
  setActiveTestTab,
  files,
  handleSubmitCode,
  submissionLoading,
  userTestsCode = "",
  signalsTracker,
  onSubmissionSuccess,
}) => {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [activeTestCaseNumber, setActiveTestCaseNumber] = useState<number | null>(null);
  const [activeUserTestCaseNumber, setActiveUserTestCaseNumber] = useState<number | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [resultMode, setResultMode] = useState<"local" | "server" | "verifying" | null>(null);
  const [stdout, setStdout] = useState<string>("");
  const [stderr, setStderr] = useState<string>("");
  const [userTestsResults, setUserTestsResults] = useState<any[]>([]);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const lastKnownHeightRef = useRef(DEFAULT_PANEL_HEIGHT);
  const isDraggingRef = useRef(false);
  const dragSnapshotRef = useRef({ startY: 0, startHeight: DEFAULT_PANEL_HEIGHT });
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  // Convert project test file to test cases format for display
  const mockTestCases: TestCase[] = useMemo(() => {
    if (!projectData) return [];

    const { testNames } = parseUnittestFile(projectData.testFile.content);
    return testNames.map((name, idx) => ({
      ID: idx,
      Name: name.replace('test_', '').replace(/_/g, ' '),
      QuestionNumber: 0,
      input: "N/A",
      expected_output: "Pass",
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    }));
  }, [projectData]);

  // Transform user tests to TestResult format
  const userTestResults: TestResult[] = useMemo(() => {
    return userTestsResults.map(transformUserTestToTestResult);
  }, [userTestsResults]);

  // Create mock TestCases for user tests
  const mockUserTestCases: TestCase[] = useMemo(() => {
    return userTestsResults.map((test, idx) =>
      createMockUserTestCase(test, idx)
    );
  }, [userTestsResults]);

  // Dynamic max height based on test count
  const getDynamicMaxHeight = useCallback(() => {
    return calculateDynamicMaxHeight(mockTestCases.length, mockUserTestCases.length);
  }, [mockTestCases.length, mockUserTestCases.length]);

  const clampPanelHeight = useCallback((value: number) => {
    const maxHeight = getDynamicMaxHeight();
    return Math.min(Math.max(value, MIN_PANEL_HEIGHT), maxHeight);
  }, [getDynamicMaxHeight]);

  const rememberHeight = useCallback((nextHeight: number) => {
    const safeHeight = clampPanelHeight(nextHeight);
    lastKnownHeightRef.current = safeHeight;
    setPanelHeight(safeHeight);
  }, [clampPanelHeight]);

  const ensureExpanded = useCallback(() => {
    setIsCollapsed(false);
    rememberHeight(lastKnownHeightRef.current || DEFAULT_PANEL_HEIGHT);
  }, [rememberHeight]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();

      // If collapsed, expand immediately and start from 0 so dragging opens to exact position
      if (isCollapsed) {
        setIsCollapsed(false);
      }

      const baseHeight = isCollapsed ? 0 : clampPanelHeight(lastKnownHeightRef.current);

      dragSnapshotRef.current = {
        startY: event.clientY,
        startHeight: baseHeight,
      };

      isDraggingRef.current = true;
      document.body.style.cursor = "row-resize";

      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [isCollapsed, clampPanelHeight]
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

  // Handle pointer events for drag resizing
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) {
        return;
      }

      const { startY, startHeight } = dragSnapshotRef.current;
      const delta = startY - event.clientY;
      const newHeight = startHeight + delta;

      // Auto-collapse only if:
      // 1. New height is below threshold AND
      // 2. We started from a reasonable height (not from collapsed state)
      if (newHeight < AUTO_COLLAPSE_THRESHOLD && startHeight >= AUTO_COLLAPSE_THRESHOLD) {
        lastKnownHeightRef.current = clampPanelHeight(startHeight); // Remember the height before collapse
        setIsCollapsed(true);
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        return;
      }

      rememberHeight(newHeight);
    };

    const endResize = (event: PointerEvent) => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      document.body.style.cursor = "";

      const handle = panelContainerRef.current?.querySelector('[role="separator"]') as HTMLElement | null;
      if (handle?.releasePointerCapture) {
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore failure (pointer might already be released)
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);

      if (isDraggingRef.current) {
        document.body.style.cursor = "";
        isDraggingRef.current = false;
      }
    };
  }, [rememberHeight, clampPanelHeight]);

  // Apply height to DOM
  useEffect(() => {
    const container = panelBodyRef.current;
    if (!container) {
      return;
    }

    const nextHeight = Math.max(contentHeight, 0);
    container.style.height = `${nextHeight}px`;
    container.style.opacity = isCollapsed ? "0" : "1";
  }, [contentHeight, isCollapsed]);

  // Handle window resize to adjust max height dynamically
  useEffect(() => {
    const handleResize = () => {
      const currentHeight = panelHeight;
      const newMaxHeight = getDynamicMaxHeight();
      if (currentHeight > newMaxHeight) {
        rememberHeight(newMaxHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [panelHeight, getDynamicMaxHeight, rememberHeight]);

  function ensureAttemptSession(): void {
    if (getSessionState()) return;
    if (projectData?.id) startAttemptSession({ projectId: projectData.id });
  }

  async function runIndividualTestCase(testCaseNumber: number) {
    if (!projectData) return;

    const startTime = performance.now(); // Start TTFR trace
    console.log(`🚀 [TTFR] Starting individual test case ${testCaseNumber}`);

    // Mark run clicked for timing signals
    signalsTracker?.markRunClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();
    const hadFailedBefore = testResults[testCaseNumber]?.passed === false;
    if (hadFailedBefore) recordRerunSameTest(testCaseNumber);

    setActiveTestCaseNumber(testCaseNumber);
    setRunningAll(false);
    setResultMode("local");

    try {
      const result = await runProjectTestCases(
        projectData,
        files,
        testCaseNumber,
        false,
        false, // Don't submit individual test runs
        userTestsCode
      );

      recordRunAndLog("run_test_case_click", projectData.id, {
        projectId: projectData.id,
        testCaseNumber,
        submittedCode: files,
        userTestsCode: userTestsCode || undefined,
      }, result);

      const newTestCaseResult = mergeTestResults(testResults, result.testResults);
      setTestResults(newTestCaseResult);
      setStdout(result.stdout);
      setStderr(result.stderr);
      setUserTestsResults(result.userTestsResults || []);

      // Calculate and log TTFR
      const totalTime = performance.now() - startTime;
      console.log(`[TTFR] Project Individual Test Case: ${totalTime.toFixed(2)}ms`);
      trackTelemetry("runner_total_latency", {
        ttfr_ms: totalTime,
        project_id: projectData.id,
        mode: "individual",
        test_case: testCaseNumber,
        context: "project"
      });
    } catch (err) {
      toast.error("There was a problem running the test case.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
    }
  }

  async function runAllTestCases() {
    if (!projectData) return;

    const startTime = performance.now(); // Start TTFR trace
    console.log("🚀🚀🚀 [TTFR] Starting runAllTestCases for PROJECT");

    // Mark run clicked for timing signals
    signalsTracker?.markRunClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();

    // Auto-expand (let user stay on current tab)
    ensureExpanded();

    setRunningAll(true);
    setActiveTestCaseNumber(-1);
    setResultMode("local");

    try {
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

      // Replace instead of merge to avoid stale rows
      setTestResults(result.testResults);
      setStdout(result.stdout);
      setStderr(result.stderr);
      setUserTestsResults(result.userTestsResults || []);

      // Use the fresh array you just computed
      const allPassed = result.testResults.every(r => r.passed);
      if (allPassed && result.testResults.length > 0) {
        toast.success(`🎉 All ${result.testResults.length} tests passed!`);
      } else {
        const passedCount = result.testResults.filter(r => r.passed).length;
        toast.error(`${passedCount}/${result.testResults.length} tests passed`);
      }

      // Calculate and log TTFR
      const totalTime = performance.now() - startTime;
      console.log(`[TTFR] Project Run All Test Cases: ${totalTime.toFixed(2)}ms`);
      trackTelemetry("runner_total_latency", {
        ttfr_ms: totalTime,
        project_id: projectData.id,
        mode: "all",
        context: "project"
      });

    } catch (err) {
      toast.error("There was a problem running all test cases.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
      setRunningAll(false);
    }
  }

  async function runIndividualUserTest(testCaseNumber: number) {
    if (!projectData || testCaseNumber < 0 || testCaseNumber >= userTestsResults.length) {
      return;
    }

    const startTime = performance.now(); // Start TTFR trace
    console.log(`🚀 [TTFR] Starting individual user test ${testCaseNumber}`);

    setActiveUserTestCaseNumber(testCaseNumber);
    setRunningAll(false);
    setResultMode("local");

    ensureExpanded();
    setActiveTestTab("user-tests");

    try {
      const testToRun = userTestsResults[testCaseNumber];

      // Run all user tests (simpler implementation)
      const result = await runProjectTestCases(
        projectData,
        files,
        -1,
        false,
        false,
        userTestsCode
      );

      setUserTestsResults(result.userTestsResults || []);

      // Toast for specific test
      const specificTestResult = result.userTestsResults?.find(
        t => t.name === testToRun.name
      );

      if (specificTestResult?.status === 'pass') {
        toast.success(`User test "${testToRun.name}" passed!`);
      } else {
        toast.error(`User test "${testToRun.name}" failed`);
      }

      // Calculate and log TTFR
      const totalTime = performance.now() - startTime;
      console.log(`[TTFR] Project Individual User Test: ${totalTime.toFixed(2)}ms`);
      trackTelemetry("runner_total_latency", {
        ttfr_ms: totalTime,
        project_id: projectData.id,
        mode: "individual_user_test",
        test_case: testCaseNumber,
        context: "project"
      });
    } catch (err) {
      toast.error("There was a problem running the user test.");
      setResultMode(null);
    } finally {
      setActiveUserTestCaseNumber(null);
    }
  }

  async function submitCode() {
    if (!projectData) return;
    const submitStartTime = performance.now();
  
    // Mark submit clicked for timing signals
    signalsTracker?.markSubmitClicked();
    void initProfileNanoFromUserGesture();
    ensureAttemptSession();
    
    // Get editor signals snapshot for submission
    const signals = signalsTracker?.snapshot();

    // Auto-expand and switch to tests tab
    ensureExpanded();
    setActiveTestTab("tests");

    setRunningAll(true);
    setActiveTestCaseNumber(-1);
    setResultMode("local");
  
    try {
      const result = await runProjectTestCases(
        projectData,
        files,
        -1,
        true,
        true, // submit
        userTestsCode,
        signals // pass editor signals
      );

      recordRunAndLog("submit_click", projectData.id, {
        projectId: projectData.id,
        submittedCode: files,
        userTestsCode: userTestsCode || undefined,
      }, result);
      await endAttemptSession("submit");

      // Replace instead of merge
      setTestResults(result.testResults);
      setStdout(result.stdout);
      setStderr(result.stderr);
      setUserTestsResults(result.userTestsResults || []);

      const allPassed = result.testResults.every(r => r.passed);
      const passedCount = result.testResults.filter(r => r.passed).length;

      if (allPassed && result.testResults.length > 0) {
        toast.success(`🎉 Submitted! All ${result.testResults.length} tests passed!`);
        // Note: Submission is already handled by runProjectTestCases with shouldSubmit=true
        // Do NOT call handleSubmitCode() here - it would create a duplicate submission
      } else {
        toast.info(`Submitted: ${passedCount}/${result.testResults.length} tests passed`);
      }

    } catch (err) {
      toast.error("There was a problem submitting your code.");
      setResultMode(null);
    } finally {
      setActiveTestCaseNumber(null);
      setRunningAll(false);
    }
  }

  function mergeTestResults(
    oldResults: TestResult[],
    newResults: TestResult[]
  ): TestResult[] {
    const keyOf = (r: any) => r.rawName ?? r.name; // raw test fn if present
    const map = new Map<string, TestResult>();
  
    oldResults.forEach(r => map.set(keyOf(r), r));
    newResults.forEach(r => map.set(keyOf(r), r));
  
    return Array.from(map.values());
  }

  function cleanStdoutForDisplay(rawStdout: string): string {
    if (!rawStdout) return "";
    
    // Remove the JSON block from output
    const jsonStartIndex = rawStdout.indexOf('=== TEST_RESULTS_JSON_START ===');
    const jsonEndIndex = rawStdout.indexOf('=== TEST_RESULTS_JSON_END ===');
    
    let cleaned = rawStdout;
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      const beforeJson = rawStdout.substring(0, jsonStartIndex);
      const afterJson = rawStdout.substring(jsonEndIndex + '=== TEST_RESULTS_JSON_END ==='.length);
      cleaned = beforeJson + afterJson;
    }
    
    // Remove lines that show the count of additional elements
    cleaned = cleaned.replace(/^(First|Second) list contains \d+ additional elements?\.\n?/gm, '');
    
    // Remove "First differing element" and "First extra element" headers
    cleaned = cleaned.replace(/^First (differing|extra) element \d+:\n?/gm, '');
    
    // Remove standalone quoted strings that appear on their own line (these are element values from unittest)
    // Match lines that are just a quoted string, possibly with leading whitespace
    cleaned = cleaned.replace(/^\s*['"'].+['"']\s*$/gm, '');
    
    // Add "Failure Reason:" label before error messages
    // This needs to happen before cleaning up blank lines
    // Match "FAIL: test_name" followed by any amount of whitespace and then an indented line
    cleaned = cleaned.replace(/FAIL: ([^\n]+)\n+\s+(.*)/g, 'FAIL: $1\n\nFailure Reason:\n  $2');
    
    // Clean up extra blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    
    // Add labels for "Your Output" and "Expected" to make it clearer
    // Replace the - and + notation with clearer labels
    cleaned = cleaned.replace(/^- (.+)$/gm, 'Your Output: $1');
    cleaned = cleaned.replace(/^\+ (.+)$/gm, 'Expected Output: $1');

    return cleaned;
  }

  const EmptyUserTestsState: React.FC = () => (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-4xl mb-4">📝</div>
      <h3 className="text-lg font-semibold text-gray-200 mb-2">
        No User Tests Run Yet
      </h3>
      <p className="text-sm text-gray-400 mb-4 max-w-md">
        Write your own tests in the &ldquo;My Tests&rdquo; file tab, then click &ldquo;Run All Tests&rdquo;
        to execute them alongside the official tests.
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

  return (
    <div ref={panelContainerRef} className="bg-primary flex flex-col">
      {/* Resize handle at the top */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize test results panel"
        onPointerDown={startResize}
        className="flex h-3 items-center justify-center cursor-row-resize border-t border-[#1e2d3d] bg-primary hover:bg-primary/90"
      >
        <div className="h-1 w-12 rounded-full bg-[#2e3d4d]" />
      </div>

      {/* Header */}
      <TestResultsPanelHeader
        activeTestTab={activeTestTab}
        setActiveTestTab={setActiveTestTab}
        runAllTestCases={runAllTestCases}
        submitCode={submitCode}
        submissionLoading={submissionLoading}
        runningAll={runningAll}
      />

      {/* Test Results Body */}
      <div
        ref={panelBodyRef}
        id="project-test-results-body"
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
                    <ResultBadge mode={resultMode} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleCollapse}
                      className="text-xs text-gray-300 hover:text-white"
                      aria-expanded={!isCollapsed}
                      aria-controls="project-test-results-body"
                    >
                      {isCollapsed ? "Show results" : "Hide results"}
                    </Button>
                  </div>
                </div>
                <TestCasesList
                  testCases={mockTestCases}
                  testResults={testResults}
                  runIndividualTestCase={runIndividualTestCase}
                  activeTestCaseNumber={activeTestCaseNumber}
                  runningAll={submissionLoading || runningAll}
                />
              </div>
            </TabsContent>

            <TabsContent value="user-tests" className="m-0">
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-sm font-medium text-primaryTextColor">Your Test Cases</div>
                  <div className="flex items-center gap-2">
                    {userTestResults.length > 0 && (
                      <span className="text-xs text-gray-400">
                        ({userTestResults.filter(r => r.passed).length}/{userTestResults.length} passed)
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleCollapse}
                      className="text-xs text-gray-300 hover:text-white"
                    >
                      {isCollapsed ? "Show results" : "Hide results"}
                    </Button>
                  </div>
                </div>

                {userTestResults.length === 0 ? (
                  <EmptyUserTestsState />
                ) : (
                  <TestCasesList
                    testCases={mockUserTestCases}
                    testResults={userTestResults}
                    runIndividualTestCase={runIndividualUserTest}
                    activeTestCaseNumber={activeUserTestCaseNumber}
                    runningAll={submissionLoading || runningAll}
                  />
                )}
              </div>
            </TabsContent>
          </Tabs>
          <Tabs value={activeTestTab} className="w-full mt-4">
            <TabsContent value="output" className="m-0">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-medium text-primaryTextColor">Output</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleCollapse}
                  className="text-xs text-gray-300 hover:text-white"
                >
                  {isCollapsed ? "Show results" : "Hide results"}
                </Button>
              </div>
              <div className="flex h-full items-center text-gray-400 whitespace-pre-wrap">
                {testResults && testResults.length > 0
                  ? testResults.map(r => r.printed).join('\n\n')
                  : "Raw output would be displayed here."}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
