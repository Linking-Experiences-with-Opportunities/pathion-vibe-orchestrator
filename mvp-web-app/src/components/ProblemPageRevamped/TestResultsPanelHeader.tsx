import React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icons } from "@/components/ui/icons";
import { isRunnerSupported } from "@/lib/codeRunner";
import { AlertCircle, Play, CheckCircle2, LayoutList, Terminal, Bug, ChevronsUpDown, BrainCircuit } from "lucide-react";

const tabTriggerClass =
  "rounded-none flex items-center gap-2 data-[state=active]:text-white data-[state=active]:bg-[#0a192f] data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:shadow-none";

interface TestResultsPanelHeaderProps {
  activeTestTab: string;
  setActiveTestTab: (tab: string) => void;
  runAllTestCases: () => void;
  submitCode: () => void;
  submissionLoading: boolean;
  runningAll: boolean;
  /** Show Diagnostics tab only when a test has failed (diagnostic loop) */
  showDiagnosticsTab?: boolean;
  handleDebug?: () => void;
  isDebugTracing?: boolean;
  debugStepIndex?: number;
  debugTotalSteps?: number;
  isCollapsed?: boolean;
  toggleCollapse?: () => void;
  /** Whether the Verification Agent is currently analyzing (Gemini thinking). */
  isVerificationAgentAnalyzing?: boolean;
}

export default function TestResultsPanelHeader({
  activeTestTab,
  setActiveTestTab,
  runAllTestCases,
  submitCode,
  submissionLoading,
  runningAll,
  showDiagnosticsTab = false,
  handleDebug,
  isDebugTracing = false,
  debugStepIndex,
  debugTotalSteps,
  isCollapsed = false,
  toggleCollapse,
  isVerificationAgentAnalyzing = false,
}: TestResultsPanelHeaderProps) {
  return (
    <div className="bg-[#141415]">
      <div className="flex border-b border-[#1e2d3d]">
        <Tabs value={activeTestTab} onValueChange={setActiveTestTab}>
          <TabsList className="bg-transparent border-b-0 rounded-none h-10">
            <TabsTrigger value="tests" className={tabTriggerClass}>
              <LayoutList size={16} className="shrink-0" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="output" className={tabTriggerClass}>
              <Terminal size={16} className="shrink-0" />
              Output
            </TabsTrigger>
            {showDiagnosticsTab && (
              <TabsTrigger value="diagnostics" className={tabTriggerClass}>
                <span className="flex items-center gap-2 text-purple-400">
                  {isVerificationAgentAnalyzing ? (
                    <BrainCircuit size={16} className="shrink-0 animate-pulse text-purple-300" />
                  ) : (
                    <Bug size={16} className="shrink-0" />
                  )}
                  Diagnostics
                  {isVerificationAgentAnalyzing && (
                    <span className="ml-1 text-[9px] font-black uppercase tracking-wider text-purple-300 animate-pulse">
                      Thinking...
                    </span>
                  )}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2 pr-4">
          {toggleCollapse && (
            <button
              type="button"
              onClick={toggleCollapse}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors mr-1"
              aria-label={isCollapsed ? "Show results" : "Hide results"}
            >
              <ChevronsUpDown size={14} />
              {isCollapsed ? "Show" : "Hide"}
            </button>
          )}
          {showDiagnosticsTab && handleDebug && (
            <button
              onClick={handleDebug}
              disabled={isDebugTracing}
              className={`text-xs font-bold flex items-center gap-2 transition-colors mr-2 ${
                isDebugTracing
                  ? "text-yellow-500/50 cursor-wait"
                  : "text-yellow-500 hover:text-yellow-400"
              }`}
            >
              {isDebugTracing ? (
                <Icons.spinner className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bug size={14} />
              )}
              {isDebugTracing
                ? "Tracing..."
                : debugTotalSteps !== undefined && debugTotalSteps > 0
                ? `Step ${(debugStepIndex ?? 0) + 1}/${debugTotalSteps}`
                : "Debugger"}
            </button>
          )}
          {!isRunnerSupported() && (
            <div className="flex items-center gap-2 mr-4 text-yellow-500 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>Desktop browser required</span>
            </div>
          )}
          <button
            type="button"
            onClick={runAllTestCases}
            disabled={runningAll || submissionLoading || !isRunnerSupported()}
            className={`px-4 py-1.5 rounded-[10px] bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none ${runningAll ? "animate-pulse" : ""}`}
          >
            <Play size={14} fill="currentColor" /> Run
          </button>
          <button
            type="button"
            onClick={submitCode}
            disabled={runningAll || submissionLoading || !isRunnerSupported()}
            className="px-4 py-1.5 rounded-[10px] bg-green-600 hover:bg-green-500 text-white text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-green-900/20 disabled:opacity-50 disabled:pointer-events-none"
          >
            {runningAll ? <Icons.spinner className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 size={14} />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
