"use client";

import React from "react";
import type { LinkedListStructure, VizMarkers } from "@/lib/vizPayload";
import { ArrowRight, RefreshCw, XCircle } from "lucide-react";

interface LinkedListVizProps {
    structure: LinkedListStructure;
    markers?: VizMarkers;
}

const NodeCard = ({
    id,
    value,
    label,
    isHead,
    isTail,
    isUnreachable,
    isCycleTarget,
    isMeet,
}: {
    id: string;
    value?: string;
    label?: string;
    isHead?: boolean;
    isTail?: boolean;
    isUnreachable?: boolean;
    isCycleTarget?: boolean;
    isMeet?: boolean;
}) => {
    return (
        <div className="flex flex-col items-center gap-2 group relative">
            {/* Head/Tail Labels */}
            <div className="h-4 pointer-events-none">
                {isHead && (
                    <span className="text-[10px] font-black text-[var(--tech-cyan)] uppercase tracking-wider animate-in fade-in slide-in-from-bottom-1 bg-[var(--tech-cyan)]/10 px-1.5 py-0.5 rounded border border-[var(--tech-cyan)]/30">
                        HEAD
                    </span>
                )}
            </div>

            {/* Node Body */}
            <div
                className={`
        relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center rounded-2xl border-2 transition-all duration-300
        ${isUnreachable
                        ? "border-zinc-800 bg-zinc-900/20 text-zinc-600 border-dashed"
                        : isMeet
                            ? "border-amber-500 bg-amber-500/10 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                            : isCycleTarget
                                ? "border-red-500 bg-red-500/10 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                                : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 hover:scale-105 hover:shadow-xl"
                    }
      `}
            >
                <span className="font-mono text-sm sm:text-base font-bold truncate max-w-[90%] text-center">
                    {value || id}
                </span>

                {/* Memory ID tooltip on hover */}
                <div className="absolute -bottom-6 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono text-zinc-500 bg-black/80 px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-10">
                    @{id}
                </div>
            </div>

            {/* Tail/Other Labels */}
            <div className="h-4 pointer-events-none flex flex-col items-center gap-1">
                {isTail && (
                    <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                        TAIL
                    </span>
                )}
                {isUnreachable && (
                    <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-tight">
                        Unreachable
                    </span>
                )}
            </div>
        </div>
    );
};

export const LinkedListViz: React.FC<LinkedListVizProps> = ({
    structure,
    markers = {},
}) => {
    const { nodes, nextPointers } = structure;

    if (!nodes || nodes.length === 0) {
        if (markers.cycleDetected) {
            return (
                <div className="flex flex-col items-center justify-center p-8 border border-red-500/20 bg-red-500/5 rounded-xl animate-pulse">
                    <RefreshCw className="w-8 h-8 text-red-500 mb-2 animate-spin-slow" />
                    <span className="text-sm font-bold text-red-400 uppercase tracking-widest">CRITICAL: Infinite Loop / Timeout</span>
                    <span className="text-xs text-red-500/60 mt-1 font-mono">Visualization halted to prevent crash</span>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center p-8 text-zinc-600 border border-dashed border-zinc-800 rounded-xl bg-[var(--canvas-void)]">
                <span className="text-xs font-mono">∅ Empty List</span>
            </div>
        );
    }

    return (
        <div className="w-full relative rounded-xl border border-[var(--structure-zinc)] bg-[var(--canvas-void)] overflow-hidden group">
            {/* Background Grid (Fixed) */}
            <div
                className="absolute inset-0 pointer-events-none opacity-20"
                style={{
                    backgroundImage:
                        "radial-gradient(var(--structure-zinc) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                }}
            />

            {/* Scrollable Viewport */}
            <div
                className="overflow-x-auto w-full p-8 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent relative z-10"
                style={{
                    // Ensure scrollbar is always accessible but styled
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'var(--structure-zinc) transparent'
                }}
            >
                {/* Content Container - Forces width based on content */}
                <div className="min-w-max mx-auto flex items-center gap-2 sm:gap-4 px-8">
                    {nodes.map((node, index) => {
                        const isHead = index === 0;
                        const isTail = index === nodes.length - 1;
                        const isUnreachable = markers.unreachableNodes?.includes(node.id);
                        const isMeet = markers.meetNode === node.id;
                        const nextPtr = nextPointers.find((p) => p.from === node.id);

                        // Check for specific edge types
                        const isBrokenLink = markers.brokenLinks?.some(
                            (bl: any) => bl.from === node.id
                        );
                        const isCycleEdge = markers.cycleEdge && markers.cycleEdge.from === node.id;

                        const isCycleTarget = markers.revisitedNodes?.includes(node.id);

                        return (
                            <React.Fragment key={node.id}>
                                {/* 1. The Node */}
                                <NodeCard
                                    id={node.id}
                                    value={node.value}
                                    label={node.label}
                                    isHead={isHead}
                                    isTail={isTail}
                                    isUnreachable={isUnreachable}
                                    isCycleTarget={isCycleTarget}
                                    isMeet={isMeet}
                                />

                                {/* 2. The Arrow (if not last, or if explicit pointer exists) */}
                                {/* 
                   logic: render arrow if there is a next pointer. 
                   If the next pointer goes to a LATER node in this linear visualization, draw simple arrow.
                   If it goes BACK (cycle), draw special cycle indicator.
                   If it goes to NULL/Broken, draw cut wire.
                */}
                                {nextPtr && (
                                    <div className="flex items-center justify-center shrink-0 w-12 sm:w-16 relative">
                                        {isCycleEdge ? (
                                            <div className="flex flex-col items-center animate-pulse">
                                                <div className="h-0.5 w-full bg-gradient-to-r from-red-500/50 to-transparent dashed relative" />
                                                <RefreshCw size={16} className="text-red-500 absolute -top-3" />
                                                <span className="text-[8px] font-bold text-red-500 uppercase mt-4 tracking-widest">Cycle</span>
                                            </div>
                                        ) : isBrokenLink ? (
                                            <div className="flex items-center justify-center w-full group/arrow overflow-hidden">
                                                <div className="h-0.5 w-1/2 bg-zinc-700" />
                                                <XCircle size={14} className="text-zinc-600 shrink-0 mx-1" />
                                                <div className="h-0.5 w-1/4 bg-zinc-700/30 border-t border-dotted border-zinc-600" />
                                            </div>
                                        ) : (
                                            // Standard Arrow
                                            <div className="w-full relative group/arrow">
                                                <div className="h-0.5 w-full bg-zinc-700 group-hover/arrow:bg-zinc-500 transition-colors" />
                                                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1">
                                                    <div className="w-2 h-2 border-t-2 border-r-2 border-zinc-700 rotate-45 group-hover/arrow:border-zinc-500 transition-colors" />
                                                </div>
                                            </div>
                                        )}

                                        {/* If pointing to a node NOT immediately next in our linear array (e.g. skip list or arbitrary), 
                            this linear viz is simplified. We assume mostly linear + cycles for this 'Projeciton'. 
                         */}
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}

                    {/* If tail points to null (explicit termination), show NULL symbol */}
                    {nodes.length > 0 && !nextPointers.find(p => p.from === nodes[nodes.length - 1].id) && (
                        <React.Fragment>
                            <div className="w-8 sm:w-12 h-0.5 bg-zinc-800" />
                            <div className="w-8 h-8 rounded border border-zinc-800 bg-zinc-900/50 flex items-center justify-center text-[10px] sm:text-xs font-mono text-zinc-600">
                                NULL
                            </div>
                        </React.Fragment>
                    )}
                </div>
            </div>

            {/* Fade Masks (Left/Right) for that "Infinite Void" look */}
            <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[var(--canvas-void)] to-transparent pointer-events-none z-20" />
            <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--canvas-void)] to-transparent pointer-events-none z-20" />
        </div>
    );
};
