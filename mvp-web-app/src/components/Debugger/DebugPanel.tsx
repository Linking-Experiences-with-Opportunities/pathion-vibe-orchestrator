import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DebugStep, DebugStackFrame } from '../CodeEditor/types';
import { VizPayloadV1 } from '@/lib/vizPayload';
import { DataStructureViz } from '@/components/VizRenderers/DataStructureViz';
import { Mermaid } from '@/components/Mermaid';
import { trackTelemetry, TelemetryError } from '@/lib/telemetryClient';
import { detectRegressions } from '@/lib/snapshotDiff';
import { UseExecutionHistoryResult } from '@/hooks/useExecutionHistory';
import {
    RotateCcw,
    Square,
    CheckCircle2,
    Bug,
    ArrowDownToLine,
    ChevronLast,
    AlertCircle,
    AlertTriangle,
    Activity,
    GitCommit,
    RefreshCw,
    GitBranch,
    WifiOff,
    X,
    Info,
    Play
} from 'lucide-react';
import { VariableInspector } from './VariableInspector';
import { DebugView } from './DebugView';
import type { StateSnapshot } from '@/lib/vizPayload';

/** Supported state snapshot types for DebugView (invariant extraction). */
const DEBUG_VIEW_SNAPSHOT_TYPES = ['linked-list', 'arraylist', 'circular-queue'] as const;
function isDebugViewSnapshot(snapshot: unknown): snapshot is StateSnapshot {
    return (
        typeof snapshot === 'object' &&
        snapshot !== null &&
        'type' in snapshot &&
        DEBUG_VIEW_SNAPSHOT_TYPES.includes((snapshot as StateSnapshot).type as typeof DEBUG_VIEW_SNAPSHOT_TYPES[number])
    );
}

/** Maximum regressions to display before truncating. */
const MAX_DISPLAYED_REGRESSIONS = 5;

interface DebugPanelProps {
    // Step Debugger Props
    step?: DebugStep | undefined;
    onStepOver?: () => void;
    onRestart?: () => void;
    onStop?: () => void;
    isFinished?: boolean;
    /** Continue to next breakpoint (or end if none). */
    onContinue?: () => void;
    /** Navigate editor to a specific call stack frame's file + line. */
    onNavigateFrame?: (file: string, line: number) => void;

    // Mermaid Viz Props
    vizPayload?: VizPayloadV1 | null;
    /** Pre-generated Mermaid source from Submit (guarantees AI ran in submit path) */
    submittedMermaidSource?: string | null;

    // Execution history for regression detection
    executionHistory?: UseExecutionHistoryResult;

    /** Session metrics for thrash/convergence display */
    sessionMetrics?: {
        thrashScore: number;
        convergenceRate: number;
        runCount: number;
    } | null;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
    step,
    onStepOver,
    onRestart,
    onStop,
    isFinished = false,
    onContinue,
    onNavigateFrame,
    vizPayload,
    submittedMermaidSource,
    executionHistory,
    sessionMetrics
}) => {
    // ================================================================
    // Telemetry error state
    // ================================================================
    const [telemetryError, setTelemetryError] = useState<TelemetryError | null>(null);

    /** When true and vizPayload has a stateSnapshot (linked-list | arraylist | circular-queue), show DebugView. */
    const [showDebugView, setShowDebugView] = useState(false);

    const handleTelemetryError = useCallback((error: TelemetryError) => {
        setTelemetryError(error);
    }, []);

    const dismissTelemetryError = useCallback(() => {
        setTelemetryError(null);
    }, []);

    // ================================================================
    // Regression detection (safely handles undefined/short history)
    // ================================================================
    const regressions = useMemo(() => {
        if (!executionHistory?.history || executionHistory.history.length < 2) return [];
        try {
            return detectRegressions(executionHistory.history);
        } catch {
            // If regression detection throws (e.g. malformed snapshot data), degrade gracefully
            console.warn("[DebugPanel] detectRegressions threw — skipping regression display");
            return [];
        }
    }, [executionHistory?.history]);

    // ================================================================
    // Telemetry for viewing the visualization
    // ================================================================
    useEffect(() => {
        if (vizPayload?.viz) {
            trackTelemetry(
                "viz_opened",
                {
                    testName: vizPayload.testName || "unknown",
                    errorCode: vizPayload.errorCode || "unknown",
                    diagramType: vizPayload.viz.diagramType,
                    source: "debug_panel"
                },
                { onError: handleTelemetryError }
            );
        }
    }, [vizPayload, handleTelemetryError]);

    // ================================================================
    // Shared: Telemetry Error Banner
    // ================================================================
    const TelemetryErrorBanner = telemetryError ? (
        <div className="mx-4 mt-3 p-3 bg-amber-950/40 border border-amber-700/50 rounded-lg flex items-start gap-3">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <div className="text-amber-300 text-xs font-semibold mb-1">
                    Telemetry Failed
                </div>
                <div className="text-amber-200/70 text-xs leading-relaxed">
                    Event <span className="font-mono font-semibold">&quot; {telemetryError.event}&quot; </span> could
                    not be sent to <span className="font-mono">POST /telemetry</span>.
                    {telemetryError.status && (
                        <span> Server responded with status <span className="font-mono font-semibold">{telemetryError.status}</span>.</span>
                    )}
                </div>
                <div className="text-amber-200/50 text-[10px] mt-1 font-mono break-all">
                    {telemetryError.message}
                </div>
            </div>
            <button
                onClick={dismissTelemetryError}
                className="p-1 hover:bg-amber-800/30 rounded text-amber-400 hover:text-amber-200 transition-colors shrink-0"
                title="Dismiss"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    ) : null;

    // ================================================================
    // Shared: Regression Banner (capped at MAX_DISPLAYED_REGRESSIONS)
    // ================================================================
    const displayedRegressions = regressions.slice(0, MAX_DISPLAYED_REGRESSIONS);
    const hiddenRegressionCount = Math.max(0, regressions.length - MAX_DISPLAYED_REGRESSIONS);

    const RegressionBanner = displayedRegressions.length > 0 ? (
        <div className="p-6 bg-red-500/[0.03] border border-red-500/20 rounded-2xl space-y-2">
            {displayedRegressions.map((reg) => (
                <div key={reg.testName} className="flex items-start gap-3 text-xs text-red-300">
                    <div className="p-2 bg-red-500/10 rounded-xl text-red-500 shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span>
                        Regression: <span className="font-black">&quot; {reg.testName}&quot; </span> was passing but fails in Run #{reg.regressedAtRun}
                    </span>
                </div>
            ))}
            {hiddenRegressionCount > 0 && (
                <div className="text-[10px] font-black text-zinc-600 uppercase tracking-widest pl-11 pt-1">
                    + {hiddenRegressionCount} more regression{hiddenRegressionCount > 1 ? "s" : ""}
                </div>
            )}
        </div>
    ) : null;

    // ================================================================
    // Helper: check if markers section has any visible content
    // ================================================================
    const hasVisibleMarkers = (markers: NonNullable<NonNullable<VizPayloadV1["viz"]>["markers"]>): boolean => {
        return !!(
            markers.cycleDetected ||
            (markers.revisitedNodes && markers.revisitedNodes.length > 0) ||
            markers.maxDepth
        );
    };

    // ================================================================
    // Mode 1: Data Structure Visualization (vizPayload)
    // ================================================================
    if (vizPayload) {
        const { viz } = vizPayload;

        // vizPayload is present but viz is null/undefined — show informational message
        if (!viz) {
            return (
                <div className="h-full flex flex-col bg-[#09090b]">
                    {TelemetryErrorBanner}
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-10">
                        <Info className="w-8 h-8 mb-3 text-zinc-600" />
                        <h3 className="text-zinc-400 font-medium text-sm mb-1">
                            No Visualization Available
                        </h3>
                        <p className="text-xs text-zinc-600 text-center max-w-xs">
                            A visualization payload was received for test &quot; {vizPayload.testName || "unknown"}&quot;
                            but it did not contain renderable structure data.
                        </p>
                    </div>
                </div>
            );
        }

        const stateSnapshot = viz.stateSnapshot;
        const hasDebugViewSnapshot = stateSnapshot && isDebugViewSnapshot(stateSnapshot);

        // WASM runtime projection (linked-list | arraylist | circular-queue) — see DebugView.tsx
        if (hasDebugViewSnapshot && showDebugView) {
            return (
                <div className="h-full flex flex-col">
                    {TelemetryErrorBanner}
                    <DebugView
                        stateSnapshot={stateSnapshot}
                        viz={viz}
                        testName={vizPayload.testName}
                        onBackToEditor={() => setShowDebugView(false)}
                        sessionMetrics={sessionMetrics}
                    />
                </div>
            );
        }

        return (
            <div className="h-full flex flex-col bg-[#09090b] animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="h-14 shrink-0 border-b border-zinc-800 bg-[#09090b] flex items-center justify-between px-6">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] flex items-center gap-2 bg-purple-500/10 px-2 py-1 rounded-xl">
                            <Bug className="w-3 h-3" />
                            Error Visualization
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasDebugViewSnapshot && (
                            <button
                                type="button"
                                onClick={() => setShowDebugView(true)}
                                className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] font-black text-red-400 uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
                            >
                                <GitBranch className="w-3.5 h-3.5" />
                                Diagnose
                            </button>
                        )}
                        <span className="text-xs text-zinc-500 font-mono truncate">
                            {vizPayload.testName || "Unknown test"}
                        </span>
                    </div>
                </div>

                {/* Telemetry error banner */}
                {TelemetryErrorBanner}

                <div className="flex-grow overflow-y-auto custom-scrollbar">
                    <div className="max-w-4xl mx-auto p-10 space-y-10">
                        {/* Regression Banner */}
                        {RegressionBanner}

                        {/* Failure Summary — triage-style card */}
                        <div className="w-full text-left bg-red-500/[0.03] border border-red-500/20 rounded-2xl p-6 hover:border-red-500/50 hover:bg-red-500/5 transition-all relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Bug size={48} className="text-red-500" />
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="p-2 bg-red-500/10 rounded-xl text-red-500 shrink-0">
                                    <AlertCircle size={20} />
                                </div>
                                <div className="flex-grow min-w-0">
                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                        <h3 className="text-sm font-black text-white uppercase tracking-widest">
                                            {vizPayload.testName || "Unknown test"}
                                        </h3>
                                        <span className="text-[9px] font-black bg-red-500 text-white px-2 py-0.5 rounded uppercase tracking-widest">
                                            Test Failed{vizPayload.errorCode ? `: ${vizPayload.errorCode}` : ""}
                                        </span>
                                    </div>
                                    {(viz.expectedSummary || viz.actualSummary) && (
                                        <div className="grid grid-cols-2 gap-4 text-xs mt-2">
                                            {viz.expectedSummary && (
                                                <div>
                                                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest block mb-0.5">Expected</span>
                                                    <span className="text-zinc-300 font-mono text-xs">{viz.expectedSummary}</span>
                                                </div>
                                            )}
                                            {viz.actualSummary && (
                                                <div>
                                                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest block mb-0.5">Actual</span>
                                                    <span className="text-zinc-300 font-mono text-xs">{viz.actualSummary}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {hasDebugViewSnapshot && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            console.log("[DebugPanel] Diagnose button clicked, switching to DebugView");
                                            setShowDebugView(true);
                                        }}
                                        className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] font-black text-red-400 uppercase tracking-widest group-hover:bg-red-500 group-hover:text-white transition-all shrink-0 cursor-pointer"
                                    >
                                        Diagnose
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Gate 2: direct prompt for diagnostic loop */}
                        <p className="text-sm text-zinc-500 italic">
                            Clicking a test will load the diagnostic visualizer for that state. Click the conflicting element in the diagram to continue.
                        </p>

                        {/* Structure Visualization (WASM Runtime Projection; use Submit-time AI source when present) */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">
                                <Activity size={14} className="text-zinc-500" />
                                Structure Visualization
                            </div>
                            <div className="w-full bg-zinc-900/50 rounded-2xl border border-zinc-800 p-4 overflow-x-auto min-h-[200px] flex items-stretch justify-center">
                                {submittedMermaidSource ? (
                                    <Mermaid chart={submittedMermaidSource} />
                                ) : (
                                    <DataStructureViz viz={vizPayload.viz ?? null} />
                                )}
                            </div>
                        </div>

                        {/* Markers List — only render if there are visible markers */}
                        {viz.markers && hasVisibleMarkers(viz.markers) && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">
                                    <GitCommit size={14} className="text-zinc-500" />
                                    Key Events & Markers
                                </div>
                                <div className="bg-zinc-900/40 rounded-2xl border border-zinc-800 divide-y divide-zinc-800/50">
                                    {viz.markers.cycleDetected && (
                                        <div className="p-3 flex items-start gap-3">
                                            <RefreshCw className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
                                            <div>
                                                <div className="text-orange-400 text-xs font-semibold">Cycle Detected</div>
                                                <div className="text-zinc-500 text-xs mt-0.5">
                                                    Infinite loop detected in structure.
                                                    {viz.markers.cycleEdge && (
                                                        <span className="font-mono ml-1 text-zinc-400">
                                                            {`Edge: ${viz.markers.cycleEdge.from} -> ${viz.markers.cycleEdge.to}`}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {viz.markers.revisitedNodes && viz.markers.revisitedNodes.length > 0 && (
                                        <div className="p-3 flex items-start gap-3">
                                            <RotateCcw className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                                            <div>
                                                <div className="text-blue-400 text-xs font-semibold">Revisited Nodes</div>
                                                <div className="text-zinc-500 text-xs mt-0.5 font-mono">
                                                    {viz.markers.revisitedNodes.join(", ")}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {viz.markers.maxDepth && (
                                        <div className="p-3 flex items-start gap-3">
                                            <GitBranch className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                                            <div>
                                                <div className="text-purple-400 text-xs font-semibold">Traversal Depth</div>
                                                <div className="text-zinc-500 text-xs mt-0.5">
                                                    Max depth reached: <span className="font-mono text-zinc-300">{viz.markers.maxDepth}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ================================================================
    // Mode 2: Step Debugger
    // ================================================================

    // Finished state
    if (isFinished) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 bg-[#09090b]">
                {TelemetryErrorBanner}
                <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-500" />
                <h3 className="text-zinc-400 font-medium text-sm">Debug Session Ended</h3>
                <div className="flex gap-3 mt-6">
                    {onRestart && (
                        <button
                            onClick={onRestart}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-200 transition-colors border border-zinc-700"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Restart
                        </button>
                    )}
                    {onStop && (
                        <button
                            onClick={onStop}
                            className="px-4 py-2 hover:bg-zinc-800/50 rounded-lg text-sm text-zinc-400 transition-colors"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Active step debugging
    if (step) {
        const hasStack = step.stack && step.stack.length > 0;

        const handleFrameClick = (frame: DebugStackFrame) => {
            if (onNavigateFrame && frame.file && frame.line) {
                onNavigateFrame(frame.file, frame.line);
            }
        };

        return (
            <div className="h-full flex flex-col bg-[#09090b] border-l border-zinc-800">
                {/* Debugger Toolbar */}
                <div className="h-14 shrink-0 border-b border-zinc-800 bg-[#09090b] flex items-center justify-between px-6">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2 bg-cyan-500/10 px-2 py-1 rounded-xl">
                            <Bug className="w-3.5 h-3.5" />
                            Debugging
                        </span>
                        {step.file && (
                            <span className="text-[10px] text-zinc-500 font-mono">
                                {step.file}:{step.line}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Continue (to next breakpoint) */}
                        {onContinue && (
                            <button
                                onClick={onContinue}
                                className="p-2 hover:bg-cyan-500/10 rounded-lg text-cyan-400 hover:text-cyan-300 transition-colors"
                                title="Continue to next breakpoint (F5)"
                            >
                                <Play className="w-4 h-4 fill-current" />
                            </button>
                        )}
                        <button
                            onClick={onStepOver}
                            disabled={!onStepOver}
                            className={`p-2 rounded-lg transition-colors ${onStepOver
                                ? "hover:bg-zinc-800 text-zinc-300 hover:text-white"
                                : "text-zinc-600 cursor-not-allowed"
                                }`}
                            title="Step Over (F10)"
                        >
                            <ChevronLast className="w-5 h-5 fill-current" />
                        </button>
                        <button
                            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 cursor-not-allowed"
                            title="Step Into (Disabled)"
                            disabled
                        >
                            <ArrowDownToLine className="w-5 h-5" />
                        </button>
                        <div className="w-px h-6 bg-zinc-800 mx-2" />
                        <button
                            onClick={onRestart}
                            disabled={!onRestart}
                            className={`p-2 rounded-lg transition-colors ${onRestart
                                ? "hover:bg-zinc-800 text-zinc-300 hover:text-white"
                                : "text-zinc-600 cursor-not-allowed"
                                }`}
                            title="Restart Debugging"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onStop}
                            disabled={!onStop}
                            className={`p-2 rounded-lg transition-colors ${onStop
                                ? "hover:bg-red-500/10 text-red-400 hover:text-red-300"
                                : "text-zinc-600 cursor-not-allowed"
                                }`}
                            title="Stop Debugging"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    </div>
                </div>

                {/* Telemetry error banner */}
                {TelemetryErrorBanner}

                {/* Call Stack — clickable frames with file:line */}
                <div className="px-6 py-3 bg-[#0c0c0e] border-b border-zinc-800">
                    <div className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-2">Call Stack</div>
                    {hasStack ? (
                        <div className="flex flex-col-reverse gap-1">
                            {step.stack.map((frame, i) => {
                                const isActive = i === step.stack.length - 1;
                                const f = typeof frame === 'string' ? { fn: frame } : frame;
                                const isClickable = !!onNavigateFrame && typeof frame !== 'string' && !!frame.file && !!frame.line;

                                return (
                                    <button
                                        key={i}
                                        onClick={() => typeof frame !== 'string' && handleFrameClick(frame)}
                                        disabled={!isClickable}
                                        className={`text-left font-mono text-xs px-3 py-2 rounded-xl transition-colors ${isActive
                                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                            : isClickable
                                                ? 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 cursor-pointer'
                                                : 'text-zinc-500'
                                            }`}
                                    >
                                        <div>{f.fn || "(anonymous)"}</div>
                                        {typeof frame !== 'string' && frame.file && (
                                            <div className="text-[10px] text-zinc-600 mt-0.5">
                                                {frame.file}{frame.line ? `: ${frame.line}` : ''}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-zinc-600 italic text-xs py-1">No call stack frames</div>
                    )}
                </div>

                {/* Variable Inspector */}
                <VariableInspector variables={step.variables ?? {}} />

                {/* Mini Output Console — triage-style bottom panel */}
                <div className="h-24 shrink-0 border-t border-zinc-800 bg-[#0c0c0e] p-4 overflow-y-auto">
                    <div className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Step Output</div>
                    {step.output ? (
                        <div className="font-mono text-xs text-zinc-300 leading-relaxed">
                            <span className="text-zinc-500 mr-2">{'›'}</span>
                            {step.output}
                        </div>
                    ) : (
                        <div className="text-zinc-500 italic text-xs">No output on this line</div>
                    )}
                </div>
            </div>
        );
    }

    // Fallback (empty — no vizPayload and no step data)
    return (
        <div className="h-full flex flex-col bg-[#09090b]">
            {TelemetryErrorBanner}
            <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm p-10">
                No debug information available
            </div>
        </div>
    );
};
