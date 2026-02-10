"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { TestResultsPanel } from "./TestResultsPanel";
import { ProjectData } from "../CodeEditor/types";
import CodeEditor from "@/components/CodeEditor/CodeEditor";
import FileTabs, { USER_TESTS_TAB } from "./FileTabs";
import { UserTestsFileTab } from "./UserTestsFileTab";
import { EditorSignalsTracker } from "@/lib/editorSignals";
import { VizPayloadV1 } from "@/lib/vizPayload";
import { UseExecutionHistoryResult } from "@/hooks/useExecutionHistory";
import { UseStepDebuggerResult } from "@/hooks/useStepDebugger";
import { UseBreakpointsResult } from "@/hooks/useBreakpoints";
import { SessionStats } from "@/hooks/useSessionStats";
import {
  setTrackingContext,
  setContentGetter,
  startDiffTracking,
  cleanupDiffTracking,
  updateLiveContent,
} from "@/lib/inputDiffTracker";
import { startAttemptSession, cleanupAttemptSession, setSessionConcepts } from "@/lib/attemptSession";

interface ProjectRightPanelProps {
    activeTestTab: string;
    setActiveTestTab: (tab: string) => void;
    projectData: ProjectData | null;
    splitPosition: number;
    files: Record<string, string>;
    activeFile: string;
    setActiveFile: (filename: string) => void;
    onFileChange: (filename: string, content: string) => void;
    handleSubmitCode: () => void;
    submissionLoading: boolean;
    userTestsCode: string;
    onUserTestsCodeChange: (code: string) => void;
    userTestsStorageKey: string | null;
    codeAutoSaveKey?: string;
    signalsTracker?: EditorSignalsTracker;
    onSubmissionSuccess?: () => void;
    vizPayload?: VizPayloadV1 | null;
    setVizPayload?: (payload: VizPayloadV1 | null) => void;
    executionHistory?: UseExecutionHistoryResult;
    stepDebugger?: UseStepDebuggerResult;
    debugHighlightLine?: number;
    breakpointLines?: number[];
    onToggleBreakpoint?: (line: number) => void;
    breakpoints?: UseBreakpointsResult;
    onNavigateFrame?: (file: string, line: number) => void;
    sessionStats?: SessionStats;
    onRecordMentalModelMatch?: () => void;
    onRecordMentalModelMismatch?: () => void;
}

export default function ProjectRightPanel({
    activeTestTab,
    setActiveTestTab,
    projectData,
    splitPosition,
    files,
    activeFile,
    setActiveFile,
    onFileChange,
    handleSubmitCode,
    submissionLoading,
    userTestsCode,
    onUserTestsCodeChange,
    userTestsStorageKey,
    codeAutoSaveKey,
    signalsTracker,
    onSubmissionSuccess,
    vizPayload,
    setVizPayload,
    executionHistory,
    stepDebugger,
    debugHighlightLine,
    breakpointLines,
    onToggleBreakpoint,
    breakpoints,
    onNavigateFrame,
    sessionStats,
    onRecordMentalModelMatch,
    onRecordMentalModelMismatch,
}: ProjectRightPanelProps) {
    const isReadOnly = activeFile === projectData?.testFile.filename;
    const isUserTestsTab = activeFile === USER_TESTS_TAB;

    // Keep a ref to the latest files so the content getter always returns current state
    const filesRef = useRef(files);
    filesRef.current = files;

    // Initialize diff tracking and attempt session for this project
    useEffect(() => {
        if (!projectData?.id) return;

        setTrackingContext({ projectId: projectData.id });
        setContentGetter(() => new Map(Object.entries(filesRef.current)));
        startDiffTracking();
        startAttemptSession({ projectId: projectData.id });
        if (projectData.conceptsExpected?.length) {
          setSessionConcepts(projectData.conceptsExpected);
        }

        return () => {
            cleanupDiffTracking();
            cleanupAttemptSession();
        };
    }, [projectData?.id]);

    // Use useCallback to ensure we always have the latest activeFile
    const handleEditorChange = useCallback((value: string | undefined) => {
        if (!isReadOnly) {
            const content = value || "";
            onFileChange(activeFile, content);
            if (projectData?.id) updateLiveContent(String(projectData.id), activeFile, content);
        }
    }, [activeFile, isReadOnly, onFileChange, projectData?.id]);

    return (
        <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden" style={{ width: `${100 - splitPosition}%` }}>
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <FileTabs
                    files={files}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    testFileName={projectData?.testFile.filename}
                />

                <div className="flex-1 min-h-0 overflow-hidden">
                    {isUserTestsTab ? (
                        <UserTestsFileTab
                            projectData={projectData}
                            files={files}
                            userTestsCode={userTestsCode}
                            onUserTestsCodeChange={onUserTestsCodeChange}
                            autoSaveKey={userTestsStorageKey}
                        />
                    ) : (
                        <CodeEditor
                            key={activeFile}
                            value={files[activeFile] || ""}
                            language="python"
                            onChange={handleEditorChange}
                            readOnly={isReadOnly}
                            autoSaveKey={codeAutoSaveKey}
                            signalsTracker={signalsTracker}
                            highlightLine={debugHighlightLine}
                            breakpointLines={breakpointLines}
                            onToggleBreakpoint={onToggleBreakpoint}
                        />
                    )}
                </div>
            </div>

            <div className="flex-none">
                <TestResultsPanel
                    mode="project"
                    projectData={projectData}
                    files={files}
                    userTestsCode={userTestsCode}
                    onUserTestsCodeChange={onUserTestsCodeChange}
                    activeTestTab={activeTestTab}
                    setActiveTestTab={setActiveTestTab}
                    handleSubmitCode={handleSubmitCode}
                    submissionLoading={submissionLoading}
                    signalsTracker={signalsTracker}
                    onSubmissionSuccess={onSubmissionSuccess}
                    externalVizPayload={vizPayload}
                    setExternalVizPayload={setVizPayload}
                    executionHistory={executionHistory}
                    stepDebugger={stepDebugger}
                    breakpoints={breakpoints}
                    onNavigateFrame={onNavigateFrame}
                    onGoToUserTests={() => setActiveFile(USER_TESTS_TAB)}
                    sessionStats={sessionStats}
                    onRecordMentalModelMatch={onRecordMentalModelMatch}
                    onRecordMentalModelMismatch={onRecordMentalModelMismatch}
                />
            </div>
        </div>
    );
}
