"use client";

import React, { useState, useEffect } from 'react';
import { DataStructureViz } from '@/components/VizRenderers/DataStructureViz';
import type { VizPayloadV1, LinkedListSnapshot } from '@/lib/vizPayload';

// ---------------------------------------------------------------------------
// Discrete stages of the Diagnostic Loop
// ---------------------------------------------------------------------------
type DiagnosticStage = 'LOCKED' | 'ACKNOWLEDGED' | 'VERIFYING' | 'RESULT';

// ---------------------------------------------------------------------------
// Props — accepts the full `viz` object so DataStructureViz can render
// the diagram and we can read `stateSnapshot` for the evidence panel.
// ---------------------------------------------------------------------------
interface DebugViewProps {
    /** Full viz object (structure + markers + stateSnapshot). */
    viz: NonNullable<VizPayloadV1['viz']>;
    testName: string;
    errorCode?: string;
    onBackToEditor: () => void;
}

// =========================================================================
// DebugView — Diagnostic Gateway state machine
// =========================================================================
export const DebugView: React.FC<DebugViewProps> = ({
    viz,
    testName,
    errorCode,
    onBackToEditor,
}) => {
    // ------------------------------------------------------------------
    // 1. Core State Machine
    // ------------------------------------------------------------------
    const [stage, setStage] = useState<DiagnosticStage>('LOCKED');
    const [prediction, setPrediction] = useState({ reachable: '', size: '' });
    const [actuals, setActuals] = useState<{ reachable: number; size: number } | null>(null);

    // Derive linked-list snapshot values (safe defaults for other types)
    const snapshot = viz.stateSnapshot;
    const isLinkedList = snapshot?.type === 'linked-list';
    const storedSize = isLinkedList
        ? (snapshot as LinkedListSnapshot).storedSize ?? 0
        : null;
    const reachableNodes = isLinkedList
        ? (snapshot as LinkedListSnapshot).reachableNodes
        : null;
    const hasMismatch =
        storedSize !== null &&
        reachableNodes !== null &&
        storedSize !== reachableNodes;

    // ------------------------------------------------------------------
    // 2. Gate 2 Interaction — Capturing the Mermaid Click
    // ------------------------------------------------------------------
    useEffect(() => {
        (window as any).mermaidNodeClick = (nodeId: string) => {
            console.log(`[Gate 2] Evidence Acknowledged on node: ${nodeId}`);
            if (stage === 'LOCKED') {
                setStage('ACKNOWLEDGED'); // Unlock Critical Reflection + Gate 3
            }
        };

        return () => {
            delete (window as any).mermaidNodeClick;
        };
    }, [stage]);

    // Reset the loop whenever a new viz arrives
    useEffect(() => {
        setStage('LOCKED');
        setPrediction({ reachable: '', size: '' });
        setActuals(null);
    }, [viz]);

    // ------------------------------------------------------------------
    // 3. Gate 3 Interaction — Verify Prediction
    // ------------------------------------------------------------------
    const handleVerify = () => {
        setStage('VERIFYING');

        // Simulated "Flattener" pause — reveals actuals after delay
        setTimeout(() => {
            setActuals({
                reachable: reachableNodes ?? 0,
                size: storedSize ?? 0,
            });
            setStage('RESULT');
        }, 1500); // 1.5 s dramatic pause
    };

    // ==================================================================
    // Render
    // ==================================================================
    return (
        <div className="flex flex-col h-full bg-[#0d1520] text-slate-200 p-6 space-y-6 overflow-y-auto">

            {/* ── HEADER: Structural Anomaly Badge ──────────────────── */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-orange-500 uppercase">
                        Structural Anomaly Detected
                    </h2>
                    <p className="text-xs text-slate-500 font-mono">
                        {testName}
                        {errorCode && <> | {errorCode}</>}
                    </p>
                </div>
                <button
                    onClick={onBackToEditor}
                    className="text-xs border border-slate-700 px-3 py-1 rounded hover:bg-slate-800 transition-colors"
                >
                    Back to Editor
                </button>
            </div>

            {/* ── TOP: Evidence Snapshot (facts only) ───────────────── */}
            {isLinkedList && (
                <div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                    <div className="text-center border-r border-slate-800">
                        <p className="text-[10px] uppercase text-slate-500">Stored Metadata</p>
                        <p
                            className={`text-2xl font-bold ${
                                hasMismatch ? 'text-orange-500' : 'text-emerald-500'
                            }`}
                        >
                            size: {storedSize}
                        </p>
                    </div>
                    <div className="text-center">
                        <p className="text-[10px] uppercase text-slate-500">Structural Reality</p>
                        <p className="text-2xl font-bold text-slate-200">
                            reachable: {reachableNodes}
                        </p>
                    </div>
                </div>
            )}

            {/* ── MIDDLE: WASM Runtime Projection (interactivity gate) ─ */}
            <div className="relative group">
                <div
                    className={`transition-all duration-500 rounded-lg ${
                        stage === 'LOCKED' ? 'ring-2 ring-orange-500/50' : ''
                    }`}
                >
                    <DataStructureViz viz={viz} />
                </div>

                {stage === 'LOCKED' && (
                    <div className="absolute inset-x-0 -bottom-4 text-center animate-bounce">
                        <span className="bg-orange-500 text-black text-[10px] font-bold px-2 py-1 rounded shadow-lg">
                            Click the mismatched evidence to unlock
                        </span>
                    </div>
                )}
            </div>

            {/* ── BOTTOM: Gate 3 Portal (Hypothesis & Verification) ──── */}
            <div
                className={`space-y-4 transition-opacity duration-700 ${
                    stage === 'LOCKED'
                        ? 'opacity-20 pointer-events-none select-none'
                        : 'opacity-100'
                }`}
            >
                {/* Critical Reflection (unlocked after Gate 2) */}
                <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
                    <h3 className="text-blue-400 text-xs font-bold uppercase mb-2">
                        Critical Reflection
                    </h3>
                    <p className="text-sm italic text-slate-400">
                        &quot;If storedSize ≠ reachableNodes, where might the size be
                        updated incorrectly? Check add() and remove().&quot;
                    </p>
                </div>

                {/* Gate 3 — Prediction inputs */}
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                    <h3 className="text-slate-500 text-[10px] font-bold uppercase mb-3 text-center">
                        Predict Reality (Gate 3)
                    </h3>
                    <div className="flex items-center justify-center space-x-4">
                        <input
                            type="number"
                            placeholder="Exp. Reachable"
                            className="bg-black border border-slate-700 rounded px-2 py-1 text-sm w-32 focus:border-blue-500 outline-none"
                            value={prediction.reachable}
                            onChange={(e) =>
                                setPrediction({ ...prediction, reachable: e.target.value })
                            }
                        />
                        <input
                            type="number"
                            placeholder="Exp. Size"
                            className="bg-black border border-slate-700 rounded px-2 py-1 text-sm w-32 focus:border-blue-500 outline-none"
                            value={prediction.size}
                            onChange={(e) =>
                                setPrediction({ ...prediction, size: e.target.value })
                            }
                        />
                        <button
                            onClick={handleVerify}
                            disabled={stage === 'VERIFYING' || !prediction.reachable}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded transition-colors"
                        >
                            {stage === 'VERIFYING' ? 'VERIFYING...' : 'VERIFY PREDICTION'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── RESULT MODAL (Post-Gate 3) ──────────────────────────── */}
            {stage === 'RESULT' && actuals && (
                <div className="bg-slate-800 p-4 rounded border border-blue-500/50 animate-in fade-in zoom-in duration-300">
                    <h4 className="text-[10px] text-slate-400 uppercase text-center mb-2">
                        Verification Result
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm text-center">
                        <div>
                            <p className="text-slate-500">Reachable</p>
                            <p
                                className={
                                    Number(prediction.reachable) === actuals.reachable
                                        ? 'text-emerald-500'
                                        : 'text-red-500'
                                }
                            >
                                {prediction.reachable} vs {actuals.reachable}{' '}
                                {Number(prediction.reachable) === actuals.reachable
                                    ? '✅'
                                    : '❌'}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-500">Stored Size</p>
                            <p
                                className={
                                    Number(prediction.size) === actuals.size
                                        ? 'text-emerald-500'
                                        : 'text-red-500'
                                }
                            >
                                {prediction.size} vs {actuals.size}{' '}
                                {Number(prediction.size) === actuals.size ? '✅' : '❌'}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
