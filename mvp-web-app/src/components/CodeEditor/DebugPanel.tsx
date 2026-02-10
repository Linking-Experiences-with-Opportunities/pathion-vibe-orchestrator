import React, { useEffect, useState, useCallback } from 'react';
import { DebugStep } from './types';
import { VizPayloadV1, StateSnapshot, LinkedListSnapshot } from '@/lib/vizPayload';
import type { UseExecutionHistoryResult } from '@/hooks/useExecutionHistory';
import { vizPayloadToMermaidSource, renderMermaidToSvg } from '@/lib/mermaidViz';
import { trackTelemetry } from '@/lib/telemetryClient';
import {
    RotateCcw,
    Square,
    CheckCircle2,
    Bug,
    ArrowRight,
    ChevronLast,
    AlertCircle,
    Activity,
    GitCommit,
    RefreshCw,
    GitBranch,
    Lock,
    Unlock,
    Eye,
    Cpu,
    Shield,
    Zap,
    AlertTriangle
} from 'lucide-react';
import { VariableInspector } from './VariableInspector';

// ---------------------------------------------------------------------------
// Gate state for the Diagnostic Gateway
// ---------------------------------------------------------------------------
type GateStatus = 'LOCKED' | 'ACKNOWLEDGED';

// ---------------------------------------------------------------------------
// Helper: build "Critical Reflection" prose from viz data
// ---------------------------------------------------------------------------
function generateCriticalReflection(viz: NonNullable<VizPayloadV1['viz']>): string {
    const parts: string[] = [];
    const ss = viz.stateSnapshot;

    if (ss?.type === 'linked-list') {
        const ll = ss as LinkedListSnapshot;
        if (ll.storedSize !== null && ll.storedSize !== ll.reachableNodes) {
            parts.push(
                `The stored size (${ll.storedSize}) does not match the number of reachable nodes (${ll.reachableNodes}). ` +
                `This indicates the size counter was not updated correctly during insertion or deletion operations.`
            );
        }
        if (ll.cycleDetected) {
            parts.push('A cycle was detected in the linked list, which will cause infinite traversal.');
        }
        if (ll.tailNextIsNull === false) {
            parts.push("The tail node's next pointer is not null, violating the linked list tail invariant.");
        }
        if (ll.tailIsLastReachable === false) {
            parts.push('The tail pointer does not reference the last reachable node in the list.');
        }
    }

    if (viz.expectedSummary && viz.actualSummary) {
        parts.push(`Expected output "${viz.expectedSummary}" but observed "${viz.actualSummary}".`);
    }

    if (parts.length === 0) {
        parts.push(
            'The runtime projection reveals a structural inconsistency between the expected and actual ' +
            'data structure state. Examine the highlighted elements for the root cause.'
        );
    }

    return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Helper: render invariant violation badges from StateSnapshot
// ---------------------------------------------------------------------------
function renderInvariantViolations(snapshot: StateSnapshot): React.ReactNode {
    const violations: { label: string; detail: string }[] = [];

    if (snapshot.type === 'linked-list') {
        const ll = snapshot as LinkedListSnapshot;
        if (ll.storedSize !== null && ll.storedSize !== ll.reachableNodes) {
            violations.push({
                label: 'Size Invariant',
                detail: `storedSize(${ll.storedSize}) ≠ reachableNodes(${ll.reachableNodes})`
            });
        }
        if (ll.tailNextIsNull === false) {
            violations.push({ label: 'Tail Invariant', detail: 'tail.next is not null' });
        }
        if (ll.tailIsLastReachable === false) {
            violations.push({ label: 'Tail Reachability', detail: 'Tail does not point to last reachable node' });
        }
    }

    if (violations.length === 0) return null;

    return violations.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
            <div>
                <div className="text-orange-400 text-[11px] font-semibold">{v.label}</div>
                <div className="text-slate-600 text-[11px] font-mono">{v.detail}</div>
            </div>
        </div>
    ));
}

// ---------------------------------------------------------------------------
// Helper: detect structural mismatch for orange highlighting
// ---------------------------------------------------------------------------
function hasSizeMismatch(snapshot?: StateSnapshot): boolean {
    if (!snapshot || snapshot.type !== 'linked-list') return false;
    const ll = snapshot as LinkedListSnapshot;
    return ll.storedSize !== null && ll.storedSize !== ll.reachableNodes;
}

// =========================================================================
// DebugPanel — Diagnostic Gateway
// =========================================================================

interface DebugPanelProps {
    // Step Debugger Props
    step?: DebugStep | undefined;
    onStepOver?: () => void;
    onRestart?: () => void;
    onStop?: () => void;
    isFinished?: boolean;

    // Mermaid Viz Props
    vizPayload?: VizPayloadV1 | null;
    executionHistory?: UseExecutionHistoryResult;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
    step,
    onStepOver,
    onRestart,
    onStop,
    isFinished = false,
    vizPayload,
    executionHistory: _executionHistory,
}) => {
    const [mermaidSvg, setMermaidSvg] = useState<string>("");
    const [gateStatus, setGateStatus] = useState<GateStatus>('LOCKED');

    // -------------------------------------------------------------------
    // Register the global callback Mermaid's click directives will invoke
    // -------------------------------------------------------------------
    const handleNodeClick = useCallback((nodeId: string) => {
        console.log(`[Gate 2] Evidence Acknowledged: ${nodeId}`);
        setGateStatus('ACKNOWLEDGED');

        trackTelemetry("gate2_acknowledged", {
            nodeId,
            testName: vizPayload?.testName,
            errorCode: vizPayload?.errorCode,
            source: "diagnostic_gateway"
        });
    }, [vizPayload]);

    useEffect(() => {
        (window as any).mermaidNodeClick = (nodeId: string) => {
            handleNodeClick(nodeId);
        };
        return () => {
            delete (window as any).mermaidNodeClick;
        };
    }, [handleNodeClick]);

    // -------------------------------------------------------------------
    // Render Mermaid SVG when vizPayload changes
    // -------------------------------------------------------------------
    useEffect(() => {
        if (vizPayload?.viz) {
            console.log("[DebugPanel] Received vizPayload:", vizPayload);
            const source = vizPayloadToMermaidSource(vizPayload.viz);
            console.log("[DebugPanel] Generated Mermaid source:", source);
            renderMermaidToSvg(source, "debug-panel-viz").then(setMermaidSvg);

            trackTelemetry("viz_opened", {
                testName: vizPayload.testName,
                errorCode: vizPayload.errorCode,
                diagramType: vizPayload.viz.diagramType,
                source: "diagnostic_gateway"
            });

            // Reset gate when a new payload arrives
            setGateStatus('LOCKED');
        } else {
            setMermaidSvg("");
        }
    }, [vizPayload]);

    // ===================================================================
    // Mode 1 — Diagnostic Gateway (Mermaid Visualization)
    // ===================================================================
    if (vizPayload) {
        const { viz } = vizPayload;
        if (!viz) return null;

        const stateSnapshot = viz.stateSnapshot;
        const mismatch = hasSizeMismatch(stateSnapshot);

        return (
            <div className="h-full flex flex-col bg-[#0a0e17] animate-in slide-in-from-right duration-300">
                {/* ─── Header ─────────────────────────────────────── */}
                <div className="h-14 shrink-0 border-b border-cyan-900/20 bg-[#0d1117] flex items-center justify-between px-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.2em] flex items-center gap-2 bg-cyan-500/10 px-2.5 py-1 rounded border border-cyan-500/20 shadow-[0_0_12px_rgba(6,182,212,0.08)]">
                            <Zap className="w-3 h-3" />
                            Diagnostic Gateway
                        </span>
                    </div>
                    <div className="text-[11px] text-slate-600 font-mono truncate max-w-[40%]">
                        {vizPayload.testName}
                    </div>
                </div>

                {/* ─── Scrollable panel stack ─────────────────────── */}
                <div className="flex-1 overflow-y-auto">

                    {/* ── Panel 1: Observation / Evidence Snapshot ── */}
                    <section className="border-b border-cyan-900/15 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <Eye className="w-3.5 h-3.5 text-cyan-500" />
                            <h3 className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.15em]">
                                Observation / Evidence Snapshot
                            </h3>
                        </div>

                        {/* Error code badge */}
                        <div className="flex items-center gap-2 text-red-400">
                            <AlertCircle size={14} />
                            <span className="font-semibold text-xs font-mono">{vizPayload.errorCode}</span>
                        </div>

                        {/* Expected vs Actual */}
                        {(viz.expectedSummary || viz.actualSummary) && (
                            <div className="grid grid-cols-2 gap-3 text-xs bg-[#0d1520] p-3 rounded-lg border border-slate-800/50">
                                {viz.expectedSummary && (
                                    <div>
                                        <span className="text-slate-600 block mb-1 text-[10px] uppercase tracking-wider font-semibold">Expected</span>
                                        <span className="text-slate-300 font-mono text-[11px]">{viz.expectedSummary}</span>
                                    </div>
                                )}
                                {viz.actualSummary && (
                                    <div>
                                        <span className="text-slate-600 block mb-1 text-[10px] uppercase tracking-wider font-semibold">Actual</span>
                                        <span className="text-slate-300 font-mono text-[11px]">{viz.actualSummary}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* State snapshot with mismatch highlighting */}
                        {stateSnapshot && (
                            <div className="bg-[#0d1520] rounded-lg border border-slate-800/50 p-3">
                                <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2 font-semibold">
                                    Runtime State
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
                                    {Object.entries(stateSnapshot)
                                        .filter(([k]) => k !== 'type')
                                        .map(([key, value]) => {
                                            const isMismatchField =
                                                mismatch && (key === 'storedSize' || key === 'reachableNodes');

                                            return (
                                                <div key={key} className="flex items-center justify-between gap-2">
                                                    <span className="text-slate-500 truncate">{key}:</span>
                                                    <span
                                                        className={
                                                            isMismatchField
                                                                ? 'text-orange-400 font-bold drop-shadow-[0_0_6px_rgba(249,115,22,0.4)]'
                                                                : 'text-slate-300'
                                                        }
                                                    >
                                                        {String(value)}
                                                        {isMismatchField && (
                                                            <AlertTriangle className="inline w-3 h-3 ml-1 -mt-0.5" />
                                                        )}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}
                    </section>

                    {/* ── Panel 2: WASM Runtime Projection ────────── */}
                    <section className="border-b border-cyan-900/15 p-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                            <h3 className="text-[10px] font-black text-cyan-400 uppercase tracking-[0.15em]">
                                WASM Runtime Projection
                            </h3>
                        </div>

                        <div
                            id="debug-panel-viz"
                            className="w-full bg-[#080c14] rounded-lg border border-cyan-900/20 p-4 overflow-x-auto min-h-[180px] flex items-center justify-center shadow-[inset_0_0_40px_rgba(6,182,212,0.03)]"
                            dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                        />

                        {gateStatus === 'LOCKED' && (
                            <div className="text-center text-[10px] text-cyan-600/50 uppercase tracking-wider animate-pulse">
                                ▸ Click a highlighted node to acknowledge evidence
                            </div>
                        )}
                    </section>

                    {/* ── Panel 3: Gate 2/3 Interactive Portal ─────── */}
                    <section className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                            {gateStatus === 'LOCKED' ? (
                                <Lock className="w-3.5 h-3.5 text-orange-500/70" />
                            ) : (
                                <Unlock className="w-3.5 h-3.5 text-cyan-400" />
                            )}
                            <h3
                                className="text-[10px] font-black uppercase tracking-[0.15em]"
                                style={{ color: gateStatus === 'LOCKED' ? '#f97316' : '#22d3ee' }}
                            >
                                Gate 2/3 — Interactive Portal
                            </h3>
                        </div>

                        {gateStatus === 'LOCKED' ? (
                            /* ── LOCKED state ─────────────────────────── */
                            <div className="bg-[#0d1520] rounded-lg border border-orange-900/30 p-6 text-center shadow-[0_0_24px_rgba(249,115,22,0.04)]">
                                <Shield className="w-8 h-8 text-orange-500/40 mx-auto mb-3" />
                                <div className="text-orange-400 font-bold text-sm mb-1">
                                    Structural Anomaly Detected
                                </div>
                                <div className="text-slate-600 text-xs mb-4">
                                    Invariant Violation
                                </div>
                                <div className="text-[10px] text-slate-700 uppercase tracking-wider">
                                    Acknowledge evidence in the projection above to proceed
                                </div>
                            </div>
                        ) : (
                            /* ── UNLOCKED state ───────────────────────── */
                            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                {/* Critical Reflection */}
                                <div className="bg-[#0d1520] rounded-lg border border-cyan-900/20 p-4 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
                                    <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                                        <Activity className="w-3 h-3" />
                                        Critical Reflection
                                    </div>
                                    <p className="text-slate-400 text-xs leading-relaxed">
                                        {generateCriticalReflection(viz)}
                                    </p>
                                </div>

                                {/* System Analysis */}
                                <div className="bg-[#0d1520] rounded-lg border border-cyan-900/20 p-4 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
                                    <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                                        <GitBranch className="w-3 h-3" />
                                        System Analysis
                                    </div>
                                    <div className="space-y-2.5">
                                        {viz.markers?.cycleDetected && (
                                            <div className="flex items-start gap-2">
                                                <RefreshCw className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="text-orange-400 text-[11px] font-semibold">Cycle Detected</div>
                                                    <div className="text-slate-600 text-[11px]">
                                                        Infinite traversal path identified.
                                                        {viz.markers.cycleEdge && (
                                                            <span className="font-mono ml-1 text-slate-500">
                                                                {`${viz.markers.cycleEdge.from} → ${viz.markers.cycleEdge.to}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {viz.markers?.revisitedNodes && viz.markers.revisitedNodes.length > 0 && (
                                            <div className="flex items-start gap-2">
                                                <RotateCcw className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="text-blue-400 text-[11px] font-semibold">Revisited Nodes</div>
                                                    <div className="text-slate-600 text-[11px] font-mono">
                                                        {viz.markers.revisitedNodes.join(", ")}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {viz.markers?.maxDepth && (
                                            <div className="flex items-start gap-2">
                                                <GitCommit className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="text-purple-400 text-[11px] font-semibold">Traversal Depth</div>
                                                    <div className="text-slate-600 text-[11px]">
                                                        Max depth: <span className="font-mono text-slate-400">{viz.markers.maxDepth}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Invariant violations from state snapshot */}
                                        {stateSnapshot && renderInvariantViolations(stateSnapshot)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        );
    }

    // ===================================================================
    // Mode 2 — Step Debugger: Finished state
    // ===================================================================
    if (isFinished) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 bg-zinc-900/20 animate-in fade-in duration-500">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-6 border border-green-500/20">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-white font-bold text-lg">Debug Session Ended</h3>
                <p className="text-sm text-zinc-500 mt-2 text-center max-w-[200px]">The execution reached the end of the script successfully.</p>
                <div className="flex flex-col gap-2 mt-8 w-full px-10">
                    <button
                        onClick={onRestart}
                        className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-bold text-white transition-all shadow-lg shadow-blue-900/20"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Restart Debugger
                    </button>
                    <button
                        onClick={onStop}
                        className="w-full py-2.5 hover:bg-zinc-800 rounded-xl text-sm font-bold text-zinc-400 transition-colors"
                    >
                        Close Debugger
                    </button>
                </div>
            </div>
        );
    }

    // ===================================================================
    // Mode 2 — Step Debugger: Active stepping
    // ===================================================================
    if (step) {
        return (
            <div className="h-full flex flex-col bg-zinc-950/50 border-l border-zinc-800 animate-in slide-in-from-right duration-300">
                {/* Debugger Toolbar */}
                <div className="h-14 shrink-0 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between px-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-yellow-500 uppercase tracking-[0.2em] flex items-center gap-2 bg-yellow-500/10 px-2 py-1 rounded">
                            <Bug className="w-3 h-3" />
                            Active Debug
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={onStepOver}
                            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-300 hover:text-white transition-all hover:scale-105 active:scale-95"
                            title="Step Over"
                        >
                            <ChevronLast className="w-5 h-5" />
                        </button>
                        <div className="w-px h-6 bg-zinc-800 mx-1"></div>
                        <button
                            onClick={onRestart}
                            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-300 hover:text-white transition-all"
                            title="Restart Debugging"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onStop}
                            className="p-2 hover:bg-red-900/20 rounded-lg text-red-500 hover:text-red-400 transition-all"
                            title="Stop Debugging"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    </div>
                </div>

                {/* Call Stack */}
                <div className="px-4 py-4 bg-zinc-900/30 border-b border-zinc-800">
                    <div className="text-[10px] text-zinc-500 mb-3 uppercase font-black tracking-widest">Call Stack</div>
                    <div className="flex flex-col-reverse gap-1.5">
                        {step.stack.map((frame, i) => (
                            <div key={i} className={`font-mono text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-2 border ${i === step.stack.length - 1
                                    ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.05)]'
                                    : 'text-zinc-600 border-transparent'
                                }`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${i === step.stack.length - 1 ? 'bg-yellow-500' : 'bg-zinc-800'}`} />
                                {typeof frame === 'string' ? frame : frame.fn}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Variable Inspector */}
                <VariableInspector variables={step.variables} />

                {/* Mini Output Console */}
                <div className="h-32 shrink-0 border-t border-zinc-800 bg-black/40 p-4 overflow-y-auto">
                    <div className="text-[10px] text-zinc-500 mb-2 uppercase font-black tracking-widest">Step Output</div>
                    {step.output ? (
                        <div className="font-mono text-sm text-zinc-300 flex items-start gap-2">
                            <ArrowRight className="w-3.5 h-3.5 mt-1 text-zinc-600 shrink-0" />
                            {step.output}
                        </div>
                    ) : (
                        <div className="text-zinc-700 italic text-[11px] h-full flex items-center justify-center border border-zinc-900 border-dashed rounded-lg">
                            Waiting for execution...
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Fallback (empty)
    return (
        <div className="h-full flex items-center justify-center text-zinc-600 text-sm p-4">
            No debug information available
        </div>
    );
};
