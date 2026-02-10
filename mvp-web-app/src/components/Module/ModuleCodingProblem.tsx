"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { Tabs, TabsList } from "@/components/ui/tabs"
import RightPanel from "@/components/ProblemPageRevamped/RightPanel";
import LeftPanel from "@/components/ProblemPageRevamped/LeftPanel";
import { TabsTriggerList } from "@/components/ProblemPageRevamped/TabsTriggerList"
import { ModuleProblemSubmissionData, ProblemSubmissionData, QuestionData } from '../CodeEditor/types';
import { Module } from "@/components/Admin/modules/ModuleList"
import { submitModuleProblem, submitProblem } from "../CodeEditor/actions";
import { toast } from "sonner";
import { useSessionContext } from '@supabase/auth-helpers-react';
import { generateStandaloneKey, loadCodeFromStorage, clearCodeFromStorage } from "@/lib/utils/codePersistence";
import { isRunnerSupported } from "@/lib/codeRunner";
import { AlertCircle, CheckCircle, ArrowLeft } from "lucide-react";
import SessionTimer from "@/components/CodeEditor/SessionTimer";
import { ModuleNavigationButtons } from "@/components/Navigation/ModuleTopBar";
import { useModuleNavigation } from "@/contexts/module-navigation-context";
import { useRouter } from "next/navigation";
import { useCanonicalSyntaxCheck } from "@/hooks/useCanonicalSyntaxCheck";

const tabs = ["prompt", "scratchpad", "solutions", "video", "submissions"]

interface ModuleCodingProblemProps {
  contentIndex: number
  problemData: QuestionData
  module: Module | undefined
  /** Called when user submits and passes all test cases (e.g. to show module completion on last problem) */
  onAllTestsPassed?: () => void
}

export default function ModuleCodingProblem({ contentIndex, problemData, module, onAllTestsPassed }: ModuleCodingProblemProps) {
  const [userAnswer, setUserAnswer] = useState<string | null>("");
  const [submissionLoading, setSubmissionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLeftTab, setActiveLeftTab] = useState("prompt")
  const [activeTestTab, setActiveTestTab] = useState("tests")
  const [splitPosition, setSplitPosition] = useState(50) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const { session } = useSessionContext();
  // const [submissions, setSubmissions] = useState<Submission[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Canonical syntax validation for execution gating
  const { isValid: syntaxIsValid, error: syntaxError, isValidating: syntaxIsValidating } = useCanonicalSyntaxCheck({
    code: userAnswer || '',
    enabled: true, // Always validate in module mode
  });

  // Check if we're in a module context (for navigation buttons)
  const { navigationState } = useModuleNavigation();
  const isInModuleContext = !!navigationState;
  const router = useRouter();

  const handleBackToModules = () => {
    router.push("/modules");
  };

  // Generate storage key for this problem
  const storageKey = useCallback(() => {
    if (!session?.user?.email || !module?.ID) {
      if (!session?.user?.email) {
        console.log('Auto-save disabled: User is not logged in');
      }
      if (!module?.ID) {
        console.log('Auto-save disabled: Module data not loaded yet');
      }
      return null;
    }
    return generateStandaloneKey(`${module.ID}:${contentIndex}`, session.user.email);
  }, [session?.user?.email, module?.ID, contentIndex]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  // Load saved code when component mounts or problem changes
  useEffect(() => {
    console.log('=== CODE LOADING DEBUG ===');
    console.log('Environment check:');
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING');
    console.log('- NEXT_PUBLIC_BACKEND_API_URL:', process.env.NEXT_PUBLIC_BACKEND_API_URL ? 'SET' : 'MISSING');
    console.log('Data check:');
    console.log('module?.ID:', module?.ID);
    console.log('session?.user?.email:', session?.user?.email);

    if (module?.ID && session?.user?.email) {
      const key = storageKey();
      console.log('Generated key for loading:', key);

      // Debug: List all localStorage keys for this user
      console.log('All localStorage keys for user:');
      for (let i = 0; i < localStorage.length; i++) {
        const localStorageKey = localStorage.key(i);
        if (localStorageKey && localStorageKey.includes(session.user.email)) {
          console.log('  -', localStorageKey);
        }
      }

      if (key) {
        const savedCode = loadCodeFromStorage(key);
        console.log('Saved code found:', savedCode ? 'YES' : 'NO');
        console.log('Saved code length:', savedCode?.length);

        if (savedCode) {
          console.log('Setting userAnswer to saved code');
          setUserAnswer(savedCode);
          return; // Don't override with starter code if we have saved code
        }
      }
    }

    // Fallback to starter code if no saved code found
    if (problemData?.codeSnippet) {
      console.log('No saved code found, using starter code');
      setUserAnswer(problemData.codeSnippet);
    }
    console.log('=== END CODE LOADING DEBUG ===');
  }, [module?.ID, problemData?.codeSnippet, session?.user?.email, storageKey]);

  // Auto-save callback
  const handleAutoSave = useCallback((code: string) => {
    const key = storageKey();
    if (key) {
      // The actual saving is handled by the CodeEditor component
      // This callback is just for logging/debugging
      console.log('Auto-saved code for module:', module?.ID, 'content index:', contentIndex);
      console.log('Saving with key:', key);
      console.log('Code length being saved:', code.length);
    }
  }, [storageKey, module?.ID, contentIndex]);

  const handleSubmitCode = async () => {
    if (!module) return;

    if (!session || !session.user || !session.user.email) {
      setError("Please login to submit your code");
      return;
    }

    setSubmissionLoading(true)
    setError(null)

    let submissionData: ModuleProblemSubmissionData = {
      sourceCode: userAnswer ?? "",
      languageID: 71,
      contentIndex: contentIndex,
      email: session.user.email,
    }

    try {
      const result = await submitModuleProblem(module.ID, submissionData);
      if (result.passedAllTestCases) {
        toast.success("Your submission passed all test cases!");
        // Clear saved code when problem is solved
        const key = storageKey();
        if (key) {
          clearCodeFromStorage(key);
        }
        onAllTestsPassed?.();
      } else {
        toast.warning("All test cases did not pass")
      }
    } catch (err) {
      toast.error("Something went wrong with your problem submission");
    } finally {
      setSubmissionLoading(false)
    }
  };

  // Page unload protection - save code before user leaves
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const key = storageKey();
      if (key && userAnswer && userAnswer !== problemData?.codeSnippet) {
        // Save current code before user leaves
        localStorage.setItem(key, userAnswer);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [userAnswer, problemData?.codeSnippet, storageKey]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newPosition = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Allow panels to be resized more freely (LeetCode-style: ~15% to ~85%)
      const clampedPosition = Math.min(Math.max(newPosition, 15), 85)
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



  if (problemData === null || problemData === undefined) {
    return (
      <div>
        loading...
      </div>
    )
  }

  // TODO: Track completion status from submissions
  const isCompleted = false;

  return (
    <div className="h-screen bg-primary text-primaryTextColor flex flex-col overflow-hidden">
      {/* Desktop-only banner */}
      {!isRunnerSupported() && (
        <div className="bg-yellow-900/20 border-b border-yellow-700 px-4 py-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-yellow-200">
            Code execution requires a desktop browser.
            Please use Chrome, Firefox, Safari, or Edge on a desktop computer.
          </span>
        </div>
      )}

      {/* Top Navigation - matches ProjectPageRevamped header */}
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
                <h1 className="text-sm font-bold text-white leading-tight">{problemData?.title}</h1>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide">{navigationState.moduleTitle}</p>
              </div>
            </div>
          ) : (
            <div className="ml-4 font-bold">{problemData?.questionNumber}. {problemData?.title}</div>
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
          {isInModuleContext && (
            <>
              <div className="border-r border-[#1e2d3d] h-8 mx-2"></div>
              <ModuleNavigationButtons />
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-primaryBorderColor">
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
            submissions={[]}
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
            contentIndex={contentIndex}
            module={module}
            handleSubmitCode={handleSubmitCode}
            submissionLoading={submissionLoading}
            autoSaveKey={storageKey() ?? undefined}
            onAutoSave={handleAutoSave}
            onAllTestsPassed={onAllTestsPassed}
            syntaxError={syntaxError}
            isValidating={syntaxIsValidating}
          />
        </div>
      </div>
    </div>
  )
}
