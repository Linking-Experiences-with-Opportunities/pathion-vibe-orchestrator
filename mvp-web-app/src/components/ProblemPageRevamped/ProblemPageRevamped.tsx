"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Tabs, TabsList } from "@/components/ui/tabs"
import RightPanel from "./RightPanel";
import LeftPanel from "./LeftPanel";
import {
  CheckCircle,
} from "lucide-react"
import { ContentNavigation } from "@/components/ui/ContentNavigation"
import { TabsTriggerList } from "./TabsTriggerList"
import { Submission } from "./models";
import { fetchProblemData, submitProblem } from '../CodeEditor/actions';
import { ProblemSubmissionData, QuestionData } from './../CodeEditor/types';
import { isRunnerSupported } from "@/lib/codeRunner";
import { AlertCircle } from "lucide-react";
import SessionTimer from "@/components/CodeEditor/SessionTimer";
import { getApiUrl } from "@/lib/apiConfig";
import { createEditorSignalsTracker, EditorSignalsTracker } from "@/lib/editorSignals";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { generateStandaloneKey, loadCodeFromStorage } from "@/lib/utils/codePersistence";
import { useCanonicalSyntaxCheck } from "@/hooks/useCanonicalSyntaxCheck";
import { useHideNavbar } from "@/contexts/navbar-visibility-context";
import { useShadowRunner } from "@/hooks/useShadowRunner";
import { useExecutionHistory } from "@/hooks/useExecutionHistory";
import { useContinuousRunner } from "@/hooks/useContinuousRunner";
import { FEATURE_TRACE_TIMELINE, FEATURE_STEP_DEBUGGER } from "@/lib/flags";
import { useStepDebugger } from "@/hooks/useStepDebugger";
import { useBreakpoints } from "@/hooks/useBreakpoints";

const tabs = ["prompt", "scratchpad", "solutions", "video", "submissions"]

interface CodingPlatformProps {
  problemId: string
}

export default function CodingPlatform({ problemId }: CodingPlatformProps) {
  const [problemData, setProblemData] = useState<QuestionData | null>(null);
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLeftTab, setActiveLeftTab] = useState("prompt")
  const [activeTestTab, setActiveTestTab] = useState("tests")

  const [splitPosition, setSplitPosition] = useState(50) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hasSolvedProblem, setHasSolvedProblem] = useState<boolean>(false)

  // Canonical syntax validation for execution gating
  const { isValid: syntaxIsValid, error: syntaxError, isValidating: syntaxIsValidating } = useCanonicalSyntaxCheck({
    code: userAnswer || '',
    enabled: true,
  });

  // Shadow runner + execution history for trace timeline
  const { run: shadowRun } = useShadowRunner({ timeoutMs: 1000 });
  const executionHistory = useExecutionHistory();

  // Step-through debugger (always call hook; worker is lazy-initialized on first startDebug)
  const stepDebuggerResult = useStepDebugger();
  const stepDebugger = FEATURE_STEP_DEBUGGER ? stepDebuggerResult : undefined;

  // Breakpoints for the debugger (single-file, use empty string as filename key)
  const breakpointsResult = useBreakpoints();
  const bpBreakpoints = FEATURE_STEP_DEBUGGER ? breakpointsResult : undefined;

  // Continuous runner: when code is valid, run shadow execution
  const { syntaxError: _continuousSyntaxError } = useContinuousRunner({
    code: userAnswer || '',
    enabled: FEATURE_TRACE_TIMELINE,
    onValidCode: useCallback(async (code: string) => {
      if (!FEATURE_TRACE_TIMELINE) return;
      const startTime = performance.now();
      const result = await shadowRun(code, []);
      const durationMs = Math.round(performance.now() - startTime);

      executionHistory.addSnapshot({
        code,
        result,
        timestamp: Date.now(),
        durationMs,
        terminated: result.error?.includes('timed out') ?? false,
      });
    }, [shadowRun, executionHistory]),
  });

  // Create editor signals tracker for this problem session
  const signalsTracker = useMemo(() => {
    return createEditorSignalsTracker();
  }, []);

  // Hide navbar for better code editor view
  useHideNavbar();

  // Session management for code persistence
  const supabase = createClientComponentClient();
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [supabase]);

  // Generate storage key for code persistence
  const codeAutoSaveKey = useMemo(() => {
    if (!problemId || !session?.user?.email) return undefined;
    return generateStandaloneKey(problemId, session.user.email);
  }, [problemId, session?.user?.email]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  // TODO: Implement submissions
  const [submissionData, setSubmissionData] = useState<ProblemSubmissionData>({
    source_code: '',
    language_id: 72, //
    expected_output: ''
  });

  useEffect(() => {
    setLoading(true);
    setError(null); // Clear previous errors

    fetchProblemData(problemId)
      .then(data => {
        // Guard against null or invalid data
        if (!data || typeof data !== 'object') {
          console.error('Problem data missing or invalid', data);
          setError('Unable to load problem data. Please try again later.');
          return;
        }

        setProblemData(data);

        // Try to load saved code from localStorage, fallback to starter code
        let initialCode = data.codeSnippet;
        if (codeAutoSaveKey) {
          const savedCode = loadCodeFromStorage(codeAutoSaveKey);
          if (savedCode) {
            initialCode = savedCode;
          }
        }

        setUserAnswer(initialCode ?? null);
        setSubmissionData(prev => ({
          ...prev,
          source_code: initialCode || '',
          expected_output: ''
        }));
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError(err.message || 'Failed to load problem. Please try again later.');
      })
      .finally(() => setLoading(false));
  }, [problemId, codeAutoSaveKey]);

  const handleSubmitCode = async () => {
    // Submit button now just triggers "Run All Tests"
    // The actual submission to backend happens automatically in action.ts
    // via submitSubmission() after tests run
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newPosition = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Allow panels to be resized more freely (~3% to ~97%)
      const clampedPosition = Math.min(Math.max(newPosition, 3), 97)
      setSplitPosition(clampedPosition)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      // Prevent text selection while dragging
      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    }

    return () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging])



  const [submissions, setSubmissions] = useState<Submission[]>([])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const url = getApiUrl(`/question/${problemId}/submissions`);
        const response = await fetch(url);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error fetching submissions: ${errorText}`);
        }

        const data: Submission[] = await response.json();

        // Defensive guard: ensure data is an array
        const submissions = Array.isArray(data) ? data : [];
        if (!Array.isArray(data)) {
          console.error("Expected submissions array from backend. Got:", data);
        }

        setSubmissions(submissions);
        submissions.forEach((submission) => {
          if (submission.QuestionsCorrect === submission.Result.length) {
            setHasSolvedProblem(true);
            return;
          }
        });
      } catch (error) {
        console.error("Failed to fetch submissions:", error);
        // Set empty array on error to prevent crashes
        setSubmissions([]);
      }
    };

    fetchData();
  }, [problemId]);

  // Show error state if data failed to load
  if (error) {
    return (
      <div className="min-h-screen bg-primary text-primaryTextColor flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full bg-red-900/20 border border-red-700 rounded-lg p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-400 mb-2">Failed to Load Problem</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-primary text-primaryTextColor flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading problem...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary text-primaryTextColor flex flex-col">
      {/* Desktop-only banner */}
      {!isRunnerSupported() && (
        <div className="bg-yellow-900/20 border-b border-yellow-700 px-4 py-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-yellow-200">
            Code execution requires a desktop browser with SharedArrayBuffer support.
            Please use Chrome, Firefox, or Edge on a desktop computer.
          </span>
        </div>
      )}

      {/* Top Navigation */}
      <header className="bg-primary border-b border-[#1e2d3d] p-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="ml-4 font-bold ">{problemData?.questionNumber}. {problemData?.title || 'Loading...'}</div>

          <div className={`flex items-center ${hasSolvedProblem ? " bg-green-600 " : " bg-gray-600 "} rounded-2xl text-xs font-semibold px-2 py-1`}>
            <CheckCircle className="h-3 w-3 mr-1" />
            <p>{hasSolvedProblem ? "Solved" : "Not solved"}</p>
          </div>
        </div>

        <div className="flex items-center">
          <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
          <div className="flex items-center mx-2">
            <SessionTimer />
          </div>
          <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
          <ContentNavigation currentId={problemId} type="problem" />
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Tabs */}
        <div className="flex-none flex border-b border-primaryBorderColor">
          <div style={{ width: `${splitPosition}%` }} className="flex">
            <Tabs value={activeLeftTab} onValueChange={setActiveLeftTab} className="w-full">
              <TabsList className="bg-transparent text-slate-500 border-b-0 rounded-none h-10">
                <TabsTriggerList
                  tabs={tabs}
                  activeTab={activeLeftTab}
                  onChange={setActiveLeftTab}
                />
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Main Content Area */}
        <div
          ref={containerRef}
          className="flex-1 flex relative min-h-0 overflow-hidden"
          style={{ cursor: isDragging ? "col-resize" : "default" }}
        >
          {/* Left Panel */}
          <LeftPanel
            splitPosition={splitPosition}
            activeLeftTab={activeLeftTab}
            problemData={problemData}
            submissions={submissions}
          />

          {/* Draggable divider - LeetCode-style resizer */}
          <div
            className="group relative flex-none z-10 cursor-col-resize"
            onMouseDown={handleMouseDown}
          >
            {/* Wider invisible hit area for easier grabbing */}
            <div className="absolute inset-y-0 -left-1 -right-1 w-3" />
            {/* Visible divider line */}
            <div className={`w-[3px] h-full transition-colors ${isDragging ? 'bg-blue-500' : 'bg-[#1e2d3d] group-hover:bg-blue-500/70'}`}>
              {/* Center grip indicator */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-1 h-1 rounded-full bg-blue-400" />
                <div className="w-1 h-1 rounded-full bg-blue-400" />
                <div className="w-1 h-1 rounded-full bg-blue-400" />
              </div>
            </div>
          </div>

          {/* Right Panel - Code Editor */}
          <RightPanel
            activeTestTab={activeTestTab}
            setActiveTestTab={setActiveTestTab}
            problemData={problemData}
            splitPosition={splitPosition}
            setUserAnswer={setUserAnswer}
            userAnswer={userAnswer}
            contentIndex={null}
            module={undefined}
            handleSubmitCode={handleSubmitCode}
            submissionLoading={false}
            autoSaveKey={codeAutoSaveKey}
            signalsTracker={signalsTracker}
            syntaxError={syntaxError}
            isValidating={syntaxIsValidating}
            executionHistory={FEATURE_TRACE_TIMELINE ? executionHistory : undefined}
            stepDebugger={stepDebugger}
            debugHighlightLine={stepDebugger?.currentLine}
            breakpointLines={bpBreakpoints?.getForFile("")}
            onToggleBreakpoint={bpBreakpoints ? (line: number) => bpBreakpoints.toggle("", line) : undefined}
            breakpoints={bpBreakpoints}
          />
        </div>
      </div>
    </div>
  )
}
