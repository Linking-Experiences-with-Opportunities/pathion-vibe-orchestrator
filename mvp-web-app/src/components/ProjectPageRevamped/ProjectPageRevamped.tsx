"use client"

import type React from "react"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Tabs, TabsList } from "@/components/ui/tabs"
import ProjectRightPanel from "./ProjectRightPanel";
import ProjectLeftPanel from "./ProjectLeftPanel";
import {
  CheckCircle,
  ArrowLeft,
} from "lucide-react"
import SessionTimer from "@/components/CodeEditor/SessionTimer";
import { ContentNavigation } from "@/components/ui/ContentNavigation"
import { ModuleNavigationButtons } from "@/components/Navigation/ModuleTopBar"
import { useModuleNavigation } from "@/contexts/module-navigation-context"
import { useRouter } from "next/navigation"
import { TabsTriggerList } from "../ProblemPageRevamped/TabsTriggerList"
import { ProjectSubmission } from "./models";
import { fetchProjectData, submitProject } from '../CodeEditor/actions';
import { ProjectData, ProjectSubmissionData } from './../CodeEditor/types';
import { fetchWithAuth } from '@/lib/fetchWithAuth';
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { generateUserTestsKey, generateProjectFileKey, loadCodeFromStorage } from "@/lib/utils/codePersistence";
import { createEditorSignalsTracker } from "@/lib/editorSignals";
import { useCanonicalSyntaxCheck } from "@/hooks/useCanonicalSyntaxCheck";
import { VizPayloadV1 } from "@/lib/vizPayload";
import { useHideNavbar } from "@/contexts/navbar-visibility-context";
import { useShadowRunner } from "@/hooks/useShadowRunner";
import { useExecutionHistory } from "@/hooks/useExecutionHistory";
import { useStepDebugger } from "@/hooks/useStepDebugger";
import { useBreakpoints } from "@/hooks/useBreakpoints";
import { useContinuousRunner } from "@/hooks/useContinuousRunner";
import { FEATURE_TRACE_TIMELINE, FEATURE_STEP_DEBUGGER /*, FEATURE_MILESTONE_VISUALIZER */ } from "@/lib/flags";
import { useSessionStats } from "@/hooks/useSessionStats";
// import { RetrospectiveView } from "../Dashboard/RetrospectiveView";

// ... (existing imports)





// Helper to validate project ID is a projectNumber (integer), not MongoDB ObjectId
const isValidProjectNumber = (id: string): boolean => {
  const looksLikeMongoId = /^[a-f0-9]{24}$/i.test(id);
  if (looksLikeMongoId) return false;
  return /^\d+$/.test(id);
};

interface ProjectCodingPlatformProps {
  projectId: string;
  initialData?: ProjectData | null;
  /** Called when user submits and passes all test cases */
  onAllTestsPassed?: () => void;
}

export default function ProjectCodingPlatform({ projectId, initialData, onAllTestsPassed }: ProjectCodingPlatformProps) {
  const [projectData, setProjectData] = useState<ProjectData | null>(initialData || null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [activeLeftTab, setActiveLeftTab] = useState("prompt")
  const [activeTestTab, setActiveTestTab] = useState("tests")
  // const [showRetrospective, setShowRetrospective] = useState(false)

  const [splitPosition, setSplitPosition] = useState(50) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Check if we're in a module context (for navigation buttons)
  const { navigationState } = useModuleNavigation();
  const isInModuleContext = !!navigationState;
  const router = useRouter();

  const handleBackToModules = () => {
    router.push("/modules");
  };

  // Multi-file state
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>("");
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);

  // User tests state (code-based)
  const [userTestsCode, setUserTestsCode] = useState<string>("");

  // Visualization state
  const [vizPayload, setVizPayload] = useState<VizPayloadV1 | null>(null);

  const handleVisualize = (payload: VizPayloadV1) => {
    setVizPayload(payload);
    // Ensure the debug tab is active in the right panel
    setActiveTestTab("debug");
  };

  // Canonical syntax validation for execution gating (active file only)
  const { isValid: syntaxIsValid, error: syntaxError, isValidating: syntaxIsValidating } = useCanonicalSyntaxCheck({
    code: files[activeFile] || '',
    enabled: !!activeFile && activeFile !== projectData?.testFile.filename,
  });

  // Shadow runner + execution history for trace timeline
  const { run: shadowRun } = useShadowRunner({ timeoutMs: 1000 });
  const executionHistory = useExecutionHistory();

  // Step-through debugger (always call hook; worker is lazy-initialized on first startDebug)
  const stepDebuggerResult = useStepDebugger();
  const stepDebugger = FEATURE_STEP_DEBUGGER ? stepDebuggerResult : undefined;

  // Breakpoints for the debugger
  const breakpointsResult = useBreakpoints();
  const bpBreakpoints = FEATURE_STEP_DEBUGGER ? breakpointsResult : undefined;

  // Auto-switch file tabs when debugger steps into a different file
  useEffect(() => {
    const debugFile = stepDebugger?.step?.file;
    if (!debugFile || !stepDebugger?.isActive) return;
    if (files[debugFile] !== undefined && debugFile !== activeFile) {
      setActiveFile(debugFile);
    }
  }, [stepDebugger?.step?.file, stepDebugger?.isActive, files, activeFile]);

  // Continuous runner: when code is valid, run shadow execution
  const { syntaxError: _continuousSyntaxError } = useContinuousRunner({
    code: files[activeFile] || '',
    enabled: FEATURE_TRACE_TIMELINE && !!activeFile && activeFile !== projectData?.testFile.filename,
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

  // Create editor signals tracker for this project session
  const signalsTracker = useMemo(() => {
    return createEditorSignalsTracker();
  }, []);

  // Session stats tracking (syntax & mental model)
  const {
    stats: sessionStats,
    recordSyntaxFailure,
    recordSyntaxSuccess,
    recordMentalModelMatch,
    recordMentalModelMismatch,
  } = useSessionStats();

  // Monitor syntax validation state to update session stats
  useEffect(() => {
    if (!syntaxIsValidating) {
      if (syntaxIsValid) {
        recordSyntaxSuccess();
      } else if (syntaxError) {
        recordSyntaxFailure();
      }
    }
  }, [syntaxIsValid, syntaxError, syntaxIsValidating, recordSyntaxSuccess, recordSyntaxFailure]);

  // Hide navbar for better code editor view
  useHideNavbar();

  // Session management for user tests persistence
  const supabase = createClientComponentClient();
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [supabase]);

  // Generate user tests storage key
  const userTestsStorageKey = useMemo(() => {
    if (!projectId || !session?.user?.email) return null;
    return generateUserTestsKey(projectId, session.user.email);
  }, [projectId, session?.user?.email]);

  // Generate storage key for active code file
  const codeAutoSaveKey = useMemo(() => {
    if (!projectId || !session?.user?.email || !activeFile) return undefined;
    // Don't save test files (they're read-only)
    if (activeFile === projectData?.testFile.filename) return undefined;
    return generateProjectFileKey(projectId, session.user.email, activeFile);
  }, [projectId, session?.user?.email, activeFile, projectData?.testFile.filename]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    const initializeProjectState = (data: ProjectData) => {
      // Initialize files with starter files and test file
      const allFiles: Record<string, string> = {
        ...data.starterFiles,
        [data.testFile.filename]: data.testFile.content
      };

      // Load any saved code files from localStorage (if user has session)
      if (session?.user?.email) {
        Object.keys(allFiles).forEach(filename => {
          // Skip the test file (read-only)
          if (filename !== data.testFile.filename) {
            const key = generateProjectFileKey(projectId, session.user.email, filename);
            const savedCode = loadCodeFromStorage(key);
            if (savedCode) {
              allFiles[filename] = savedCode;
            }
          }
        });
      }

      setFiles(allFiles);

      // Set the first starter file as active (not the test file)
      const firstStarterFile = Object.keys(data.starterFiles)[0];
      if (firstStarterFile) {
        setActiveFile(firstStarterFile);
      }

      // Load user tests code using new pattern
      if (userTestsStorageKey) {
        const savedUserTestsCode = loadCodeFromStorage(userTestsStorageKey);
        if (savedUserTestsCode) {
          setUserTestsCode(savedUserTestsCode);
        }
      }
    };

    // Skip fetching if we already have the correct project data
    // Check both projectNumber and id for compatibility
    const projectMatches = projectData && (
      String(projectData.projectNumber) === projectId ||
      projectData.id === projectId
    );

    if (projectMatches) {
      setLoading(false);
      // Initialize files if they haven't been initialized yet
      if (Object.keys(files).length === 0) {
        initializeProjectState(projectData);
      }
      return;
    }

    // Validate projectId before fetching
    if (!isValidProjectNumber(projectId)) {
      setError(`Invalid project ID format: ${projectId}. Expected a numeric projectNumber.`);
      setLoading(false);
      return;
    }

    setLoading(true);

    fetchProjectData(projectId)
      .then(data => {
        setProjectData(data);
        initializeProjectState(data);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [projectId, userTestsStorageKey, session?.user?.email]); // eslint-disable-line react-hooks/exhaustive-deps -- files/projectData intentionally excluded to avoid re-init loop

  // Load saved code from localStorage when session becomes available
  // This handles the race condition where files initialize before session loads
  useEffect(() => {
    if (!session?.user?.email || !projectData || Object.keys(files).length === 0) return;

    // Check if we need to load any saved code
    const updatedFiles: Record<string, string> = {};
    let hasUpdates = false;

    Object.keys(files).forEach(filename => {
      // Skip test files (read-only)
      if (filename === projectData.testFile.filename) return;

      const key = generateProjectFileKey(projectId, session.user.email, filename);
      const savedCode = loadCodeFromStorage(key);

      // If we have saved code and current file is still starter code, update it
      if (savedCode && files[filename] === projectData.starterFiles[filename]) {
        updatedFiles[filename] = savedCode;
        hasUpdates = true;
      }
    });

    if (hasUpdates) {
      setFiles(prev => ({
        ...prev,
        ...updatedFiles
      }));
    }
  }, [session?.user?.email, projectData, projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- files excluded to avoid loop

  const handleFileChange = (filename: string, content: string) => {
    setFiles(prev => ({
      ...prev,
      [filename]: content
    }));
  };

  const handleSubmitCode = async () => {
    if (!projectData) return;

    setSubmissionLoading(true);
    try {
      const submissionData: ProjectSubmissionData = {
        problemId: projectData.id,
        userId: "user@example.com", // TODO: Get from auth context
        language: "python",
        sourceType: "project",
        files: files,
        result: null,
        meta: {
          pyodideVersion: "0.23.4"
        }
      };

      await submitProject(submissionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmissionLoading(false);
    }
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



  // Compute completion status using the same logic as projectCard
  // Check if ANY submission passed (not just the first one)
  const isCompleted = submissions.some(sub =>
    sub.passed ||
    (sub.result?.testSummary &&
      sub.result.testSummary.total > 0 &&
      sub.result.testSummary.passed === sub.result.testSummary.total)
  )
  const latestSubmission = submissions.length > 0 ? submissions[0] : null
  const isStarted = latestSubmission?.result?.testSummary &&
    latestSubmission.result.testSummary.total > 0 && !isCompleted

  useEffect(() => {
    const fetchData = async () => {
      // Validate projectId before making API call
      if (!isValidProjectNumber(projectId)) {
        return;
      }

      try {
        const supabase = createClientComponentClient();
        const { data: { session } } = await supabase.auth.getSession();

        const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects/${projectId}/submissions`;
        const response = await fetchWithAuth(url);

        if (!response.ok) {
          if (response.status === 404) {
            setSubmissions([]);
            return;
          }
          const errorText = await response.text();
          throw new Error(`Error fetching project submissions: ${errorText}`);
        }

        const responseData = await response.json();
        const data: ProjectSubmission[] = responseData.submissions || [];

        // Sort submissions by createdAt in descending order (newest first)
        const sortedData = [...data].sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA; // Descending order (newest first)
        });

        setSubmissions(sortedData)
      } catch {
        setSubmissions([]);
      }
    };

    fetchData();
  }, [projectId]);

  if (loading && !projectData) {
    return (
      <div className="min-h-screen bg-primary text-primaryTextColor flex items-center justify-center">
        <p>Loading project...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-primary text-primaryTextColor flex items-center justify-center">
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-primary text-primaryTextColor flex flex-col overflow-hidden">
      {/* Top Navigation */}
      <header className="flex-none bg-primary border-b border-[#1e2d3d] p-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {/* Back to Modules button - only show when in module context */}
          {isInModuleContext && (
            <>
              <button
                onClick={handleBackToModules}
                className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-zinc-800"
              >
                <ArrowLeft size={16} />
                Back to Modules
              </button>
              <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
            </>
          )}

          {/* Module-aware title design when in module context */}
          {isInModuleContext && navigationState ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center font-bold text-xs">
                {navigationState.moduleNumber}-{navigationState.currentIndex + 1}
              </div>
              <div>
                <h1 className="text-sm font-bold text-white leading-tight">{projectData?.title}</h1>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide">{navigationState.moduleTitle}</p>
              </div>
            </div>
          ) : (
            <div className="ml-4 font-bold">{projectData?.projectNumber}. {projectData?.title}</div>
          )}

          <div className={`flex items-center ${isCompleted ? " bg-green-600 " : " bg-gray-600 "} rounded-2xl text-xs font-semibold px-2 py-1`}>
            <CheckCircle className="h-3 w-3 mr-1" />
            <p>{isCompleted ? "Solved" : "Not solved"}</p>
          </div>
        </div>

        <div className="flex items-center">
          <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
          <div className="flex items-center mx-2">
            <SessionTimer />
          </div>
          <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
          {/* Show module navigation when in module context, otherwise show project navigation */}
          {isInModuleContext ? (
            <ModuleNavigationButtons />
          ) : (
            <ContentNavigation currentId={projectId} type="project" />
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">


        {/* Main Content Area */}
        <div
          ref={containerRef}
          className="flex-1 flex relative min-h-0 overflow-hidden"
          style={{ cursor: isDragging ? "col-resize" : "default" }}
        >
          {/* Left Panel */}
          <ProjectLeftPanel
            splitPosition={splitPosition}
            activeLeftTab={activeLeftTab}
            setActiveLeftTab={setActiveLeftTab}
            projectData={projectData}
            submissions={submissions}
            onVisualize={handleVisualize}
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
          <ProjectRightPanel
            activeTestTab={activeTestTab}
            setActiveTestTab={setActiveTestTab}
            projectData={projectData}
            splitPosition={splitPosition}
            files={files}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            onFileChange={handleFileChange}
            handleSubmitCode={handleSubmitCode}
            submissionLoading={submissionLoading}
            userTestsCode={userTestsCode}
            onUserTestsCodeChange={setUserTestsCode}
            userTestsStorageKey={userTestsStorageKey}
            codeAutoSaveKey={codeAutoSaveKey}
            signalsTracker={signalsTracker}
            onSubmissionSuccess={onAllTestsPassed}
            /* Milestone Visualizer - commented out for demo
            onSubmissionSuccess={() => {
              if (FEATURE_MILESTONE_VISUALIZER) {
                setShowRetrospective(true);
              }
              onAllTestsPassed?.();
            }}
            */
            vizPayload={vizPayload}
            setVizPayload={setVizPayload}
            executionHistory={FEATURE_TRACE_TIMELINE ? executionHistory : undefined}
            stepDebugger={stepDebugger}
            debugHighlightLine={stepDebugger?.currentLine}
            breakpointLines={bpBreakpoints?.getForFile(activeFile)}
            onToggleBreakpoint={bpBreakpoints ? (line: number) => bpBreakpoints.toggle(activeFile, line) : undefined}
            breakpoints={bpBreakpoints}
            onNavigateFrame={(file: string) => {
              if (files[file] !== undefined) {
                setActiveFile(file);
              }
            }}
            sessionStats={sessionStats}
            onRecordMentalModelMatch={recordMentalModelMatch}
            onRecordMentalModelMismatch={recordMentalModelMismatch}
          />

          {/* Milestone Visualizer - commented out for demo
          {showRetrospective && FEATURE_MILESTONE_VISUALIZER && (
            <RetrospectiveView
              onDone={() => setShowRetrospective(false)}
              history={executionHistory.history}
            />
          )}
          */}
        </div>
      </div>
    </div>
  )
}


