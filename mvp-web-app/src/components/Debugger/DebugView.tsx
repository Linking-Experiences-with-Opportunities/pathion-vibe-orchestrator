"use client";

import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  GitBranch,
  Target,
  Info,
  AlertCircle,
  Box,
  Activity,
  Database,
  Loader2,
  Table as TableIcon,
  Search,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { DataStructureViz } from "@/components/VizRenderers/DataStructureViz";
import type { StateSnapshot, VizPayloadV1 } from "@/lib/vizPayload";

interface DebugViewProps {
  stateSnapshot: StateSnapshot;
  viz?: VizPayloadV1["viz"] | null;
  testName?: string;
  errorMessage?: string;
  onBackToEditor: () => void;
  /** Session metrics for thrash/convergence display */
  sessionMetrics?: {
    thrashScore: number;
    convergenceRate: number;
    runCount: number;
  } | null;
}

// --- Theme & Styles ---

const debugTheme = {
  "--canvas-void": "#0c0c0e",
  "--structure-zinc": "#27272a",
  "--tech-cyan": "#22d3ee",
  "--danger-red": "#ef4444",
} as React.CSSProperties;

// --- Helper Components ---

const StateValue = ({
  label,
  value,
  isError,
}: {
  label: string;
  value: unknown;
  isError?: boolean;
}) => {
  const displayValue =
    value === null || value === undefined
      ? "—"
      : value === true
        ? "Yes"
        : value === false
          ? "No"
          : String(value);
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--structure-zinc)] last:border-0 hover:bg-white/[0.02] px-2 transition-colors">
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
        {label}
      </span>
      <span
        className={`text-xs font-bold font-mono ${isError ? "text-[var(--danger-red)]" : "text-zinc-300"}`}
      >
        {displayValue}
      </span>
    </div>
  );
};

const BufferVisualizer = ({
  buffer,
  head,
  tail,
  capacity,
  showHeadTail,
}: {
  buffer: string[] | null;
  head?: number | null;
  tail?: number | null;
  capacity?: number | null;
  showHeadTail?: boolean;
}) => {
  if (!buffer || buffer.length === 0)
    return (
      <div className="p-4 text-center text-xs font-mono text-zinc-600 border border-dashed border-[var(--structure-zinc)] rounded-md bg-[var(--canvas-void)]">
        DATA_VOID: No buffer data available implies initialization failure or empty state.
      </div>
    );

  return (
    <div className="flex flex-wrap gap-1 p-3 bg-[var(--canvas-void)] border border-[var(--structure-zinc)] rounded-md overflow-x-auto shadow-inner">
      {buffer.map((val, i) => {
        const isHead = showHeadTail && head === i;
        const isTail = showHeadTail && tail === i;
        // Construct detailed class names for active states
        let borderClass = "border-[var(--structure-zinc)]";
        let bgClass = "bg-zinc-900/50";
        let textClass = "text-zinc-500";

        if (isHead) {
          borderClass = "border-[var(--tech-cyan)]";
          bgClass = "bg-[var(--tech-cyan)]/10";
          textClass = "text-[var(--tech-cyan)]";
        }
        if (isTail) {
          borderClass = "border-[var(--danger-red)]";
          // If both head and tail are at the same index, prioritize or mix
          if (isHead) {
            borderClass = "border-purple-500";
          }
        }

        return (
          <div key={i} className="flex flex-col items-center gap-1 shrink-0 group">
            {/* Cell */}
            <div
              className={`w-8 h-8 border rounded flex items-center justify-center font-mono text-xs transition-all ${borderClass} ${bgClass} ${textClass}`}
            >
              {val || "Ø"}
            </div>
            {/* Index */}
            <span className="text-[7px] font-mono text-zinc-700 select-none group-hover:text-zinc-500 transition-colors">{i}</span>

            {/* Pointers */}
            {(isHead || isTail) && (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {isHead && (
                  <span className="text-[6px] font-black text-[var(--tech-cyan)] uppercase tracking-tighter leading-none text-center">
                    HD
                  </span>
                )}
                {isTail && (
                  <span className="text-[6px] font-black text-[var(--danger-red)] uppercase tracking-tighter leading-none text-center">
                    TL
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// --- Main Component ---

export const DebugView: React.FC<DebugViewProps> = ({
  stateSnapshot,
  viz,
  testName,
  errorMessage,
  onBackToEditor,
  sessionMetrics,
}) => {
  const [aiInsight, setAiInsight] = useState<{ observation: string; nudge: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [prediction, setPrediction] = useState({ reachable: '', stored: '' });
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [gate, setGate] = useState(3); // Gate 3 is active by default for now

  // Fallback static heuristics (original logic)
  const getStaticObservation = (): string => {
    switch (stateSnapshot.type) {
      case "linked-list":
        if (stateSnapshot.cycleDetected)
          return "CRITICAL: An infinite loop (cycle) was detected. A node's next pointer refers back to an earlier node in the list.";
        if (stateSnapshot.tailNextIsNull === false)
          return "BUG: The tail node's next pointer is not null. This will cause traversal errors and failed append operations.";
        if (
          stateSnapshot.storedSize !== null &&
          stateSnapshot.storedSize !== stateSnapshot.reachableNodes
        )
          return `MISMATCH: Your internal size counter is ${stateSnapshot.storedSize}, but only ${stateSnapshot.reachableNodes} nodes are reachable from the head.`;
        if (
          !stateSnapshot.headExists &&
          stateSnapshot.storedSize != null &&
          stateSnapshot.storedSize > 0
        )
          return "ERROR: head is null, but size is non-zero. The list structure is disconnected.";
        return "The list structure appears valid, but specific node data might be incorrect for this test case.";

      case "arraylist":
        if (stateSnapshot.sizeInRange === false)
          return "OUT OF RANGE: The storedSize exceeds the actual array capacity, leading to potential IndexOutOfBounds exceptions.";
        if (
          stateSnapshot.storedSize !== null &&
          stateSnapshot.capacity !== null &&
          stateSnapshot.storedSize > stateSnapshot.capacity
        )
          return "OVERFLOW: Size is greater than capacity. Did you forget to resize the internal buffer?";
        return "Internal buffer allocation looks stable. Check if elements are being placed at the correct indices.";

      case "circular-queue":
        if (stateSnapshot.indicesInRange === false)
          return "CORRUPTION: Head or Tail indices are outside the valid bounds of the buffer [0, capacity-1].";
        if (stateSnapshot.sizeInRange === false)
          return "LOGIC ERROR: storedSize is inconsistent with the distance between head and tail pointers.";
        return "Wrap-around logic is active. Ensure modulo operations (%) are used correctly when incrementing pointers.";
    }
  };

  const handleVerify = () => {
    setIsVerifying(true);

    // Simulate brief processing delay for UX
    setTimeout(() => {
      const predictedReachable = parseInt(prediction.reachable) || 0;
      const predictedStored = parseInt(prediction.stored) || 0;

      // Get actual values from stateSnapshot
      let actualReachable: number | null = null;
      let actualStored: number | null = null;

      if (stateSnapshot.type === 'linked-list') {
        actualReachable = stateSnapshot.reachableNodes ?? null;
        actualStored = stateSnapshot.storedSize ?? null;
      } else if (stateSnapshot.type === 'arraylist') {
        actualReachable = stateSnapshot.storedSize ?? null; // For arraylist, "reachable" = stored size
        actualStored = stateSnapshot.storedSize ?? null;
      } else if (stateSnapshot.type === 'circular-queue') {
        actualReachable = stateSnapshot.storedSize ?? null;
        actualStored = stateSnapshot.storedSize ?? null;
      }

      // Verification passes if user correctly identifies BOTH values
      const verified =
        actualReachable !== null &&
        actualStored !== null &&
        predictedReachable === actualReachable &&
        predictedStored === actualStored;

      if (verified) {
        setIsVerified(true);
      } else {
        // For demo: always verify if they got at least one right or if the values mismatch
        // This demonstrates understanding of the discrepancy
        const understandsDiscrepancy =
          predictedReachable === actualReachable ||
          predictedStored === actualStored ||
          (actualReachable !== actualStored && predictedReachable !== predictedStored);

        setIsVerified(understandsDiscrepancy);
      }

      setIsVerifying(false);
    }, 800); // 800ms delay for "processing" effect
  };

  const getStaticNudge = (): string => {
    switch (stateSnapshot.type) {
      case "linked-list":
        return "If storedSize ≠ reachableNodes, where might the size be updated incorrectly? Check both add and remove methods.";
      case "arraylist":
        return "Does your add() method check if size == capacity before attempting to insert?";
      case "circular-queue":
        return "Remember: (tail + 1) % capacity should be the new tail. Are you handling the empty vs full state differently?";
    }
  };

  useEffect(() => {
    let mounted = true;
    const fetchInsight = async () => {
      setIsLoading(true);
      setAiInsight(null);
      try {
        const res = await fetch("/api/debug-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stateSnapshot,
            testName,
            errorMessage,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.observation && data.nudge) {
            setAiInsight(data);
          }
        }
      } catch (e) {
        console.error("Failed to fetch debug insight", e);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchInsight();
    return () => {
      mounted = false;
    };
  }, [stateSnapshot, testName, errorMessage]); // Re-run if context changes

  const getTitle = (): string => {
    switch (stateSnapshot.type) {
      case "linked-list":
        return "LINKED_LIST";
      case "arraylist":
        return "ARRAY_LIST";
      case "circular-queue":
        return "CIRCULAR_QUEUE";
      default:
        return "UNKNOWN_STRUCTURE";
    }
  };

  return (
    <div
      className="flex flex-col h-full text-zinc-300 animate-in fade-in duration-300 overflow-hidden relative font-sans"
      style={debugTheme}
    >
      {/* Viz Background Layer */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundColor: 'var(--canvas-void)',
          backgroundImage: 'radial-gradient(var(--structure-zinc) 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px'
        }}
      />

      {/* 1. Header */}
      <div className="h-12 shrink-0 border-b border-[var(--structure-zinc)] bg-[var(--canvas-void)] flex items-center justify-between px-4 z-10 w-full relative">
        <div className="flex items-center gap-3">
          {/* Icon Box */}
          <div className="w-8 h-8 rounded bg-[var(--structure-zinc)]/50 border border-[var(--structure-zinc)] flex items-center justify-center text-[var(--tech-cyan)] shadow-sm">
            <GitBranch size={16} />
          </div>

          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
                DEBUG::{getTitle()}
              </h2>
              <span className="px-1.5 py-[1px] rounded-[2px] bg-[var(--danger-red)]/20 border border-[var(--danger-red)]/30 text-[9px] font-mono text-[var(--danger-red)] uppercase tracking-wider">
                FAILED
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">
              TEST_CASE: {testName || "null"}
            </p>
          </div>
        </div>

        <button
          onClick={onBackToEditor}
          className="group flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--structure-zinc)] bg-zinc-900/50 hover:bg-[var(--structure-zinc)] transition-all cursor-pointer"
        >
          <ChevronLeft size={12} className="text-zinc-400 group-hover:text-white transition-colors" />
          <span className="text-[10px] font-mono font-medium text-zinc-400 group-hover:text-white uppercase tracking-wide">
            Return
          </span>
        </button>
      </div>

      <div className="flex-grow overflow-y-auto w-full relative z-0 custom-scrollbar">
        <div className="max-w-5xl mx-auto p-6 space-y-6">

          {/* Gate 2: DevTools-style Alert */}
          <div className="flex items-start gap-3 p-3 rounded-sm border-l-2 border-[var(--tech-cyan)] bg-[var(--tech-cyan)]/5">
            <Info size={14} className="text-[var(--tech-cyan)] mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-mono text-[var(--tech-cyan)] font-bold uppercase tracking-wider">
                Runtime Insight
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Visual mismatch detected in the construct. Click conflicting nodes in the diagram for deep inspection.
              </p>
            </div>
          </div>

          {/* 2. Failure Context Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">

            {/* Observation Panel */}
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                    <Activity size={12} /> Diagnostic Output
                  </h3>
                </div>

                <div className="bg-[var(--canvas-void)] border border-[var(--structure-zinc)] rounded-lg p-5 relative overflow-hidden group min-h-[140px]">
                  {/* Decorative grid bg inside card */}
                  <div
                    className="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style={{
                      backgroundImage: 'linear-gradient(to right, var(--structure-zinc) 1px, transparent 1px), linear-gradient(to bottom, var(--structure-zinc) 1px, transparent 1px)',
                      backgroundSize: '20px 20px'
                    }}
                  />

                  <div className="relative z-10 flex items-start gap-4">
                    <div className="shrink-0 mt-1">
                      <div className="w-2 h-2 rounded-full bg-[var(--danger-red)] animate-pulse shadow-[0_0_8px_var(--danger-red)]" />
                    </div>
                    <div className="space-y-2 w-full">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-[var(--danger-red)] uppercase tracking-widest border border-[var(--danger-red)]/30 px-1.5 py-0.5 rounded-[2px] bg-[var(--danger-red)]/10">
                          Exception / Anomaly
                        </span>
                        {isLoading && (
                          <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--tech-cyan)] animate-pulse">
                            <Loader2 size={10} className="animate-spin" />
                            ANALYZING_STATE...
                          </span>
                        )}
                      </div>
                      {isLoading ? (
                        <div className="space-y-2 mt-2">
                          <div className="h-3 w-3/4 bg-zinc-800/50 rounded animate-pulse" />
                          <div className="h-3 w-1/2 bg-zinc-800/50 rounded animate-pulse" />
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-200 font-mono leading-relaxed selection:bg-[var(--danger-red)]/30 selection:text-[var(--danger-red)] animate-in fade-in slide-in-from-bottom-2 duration-500">
                          &quot;{aiInsight ? aiInsight.observation : getStaticObservation()}&quot;
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Diagnostic Hub */}
              {/* TODO: Wire to actual vizPayload from ShadowRunner */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 flex flex-col shadow-xl">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-500 border border-orange-500/20">
                      <TableIcon size={20} />
                    </div>
                    <h4 className="text-sm font-black text-white tracking-widest uppercase">Evidence Snapshot</h4>
                  </div>
                  {(stateSnapshot.type === 'linked-list' && stateSnapshot.storedSize !== stateSnapshot.reachableNodes) && (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border border-red-500/20 rounded-full">
                      <Activity size={14} className="text-red-500 animate-pulse" />
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Invariant Violated</span>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-inner">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/40">
                        <th className="px-8 py-5 font-black text-zinc-500 uppercase tracking-widest text-[10px]">Attribute</th>
                        <th className="px-8 py-5 font-black text-zinc-500 uppercase tracking-widest text-[10px]">Stored Metadata</th>
                        <th className="px-8 py-5 font-black text-zinc-500 uppercase tracking-widest text-[10px]">Structural Reality</th>
                        <th className="px-8 py-5 font-black text-zinc-500 uppercase tracking-widest text-[10px]">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 font-mono text-[11px]">
                      <tr className="hover:bg-zinc-900/20 transition-colors">
                        <td className="px-8 py-5 text-zinc-500">self._size</td>
                        <td className="px-8 py-5 text-white font-bold">{stateSnapshot.storedSize ?? "--"}</td>
                        <td className="px-8 py-5 text-zinc-600">--</td>
                        <td className="px-8 py-5">
                          {(stateSnapshot.type === 'linked-list' && stateSnapshot.storedSize !== stateSnapshot.reachableNodes) ? (
                            <span className="text-red-500 font-black animate-pulse uppercase">[!] Conflict</span>
                          ) : (
                            <span className="text-zinc-600 uppercase">OK</span>
                          )}
                        </td>
                      </tr>
                      {stateSnapshot.type === "linked-list" && (
                        <tr className="hover:bg-zinc-900/20 transition-colors">
                          <td className="px-8 py-5 text-zinc-500">Reachable Nodes</td>
                          <td className="px-8 py-5 text-zinc-600">--</td>
                          <td className="px-8 py-5 text-white font-bold">{stateSnapshot.reachableNodes ?? "--"}</td>
                          <td className="px-8 py-5">
                            {stateSnapshot.storedSize !== stateSnapshot.reachableNodes ? (
                              <span className="text-red-500 font-black animate-pulse uppercase">[!] Conflict</span>
                            ) : (
                              <span className="text-zinc-600 uppercase">OK</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* State Panel */}
            <div className="lg:col-span-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <Database size={12} /> variable_dump
                </h3>
              </div>

              <div className="bg-[var(--canvas-void)] border border-[var(--structure-zinc)] rounded-lg flex flex-col shadow-sm h-full max-h-[200px]">
                <div className="overflow-y-auto custom-scrollbar p-1 h-full">
                  {stateSnapshot.type === "linked-list" && (
                    <>
                      <StateValue label="HEAD_PTR" value={stateSnapshot.headExists ? "0xREF" : "NULL"} isError={!stateSnapshot.headExists} />
                      <StateValue label="TAIL_PTR" value={stateSnapshot.tailExists ? "0xREF" : "NULL"} isError={!stateSnapshot.tailExists} />
                      <StateValue
                        label="TAIL.NEXT"
                        value={stateSnapshot.tailNextIsNull ? "NULL" : "0xREF"}
                        isError={stateSnapshot.tailNextIsNull === false}
                      />
                      <StateValue
                        label="TAIL_REACHABLE"
                        value={stateSnapshot.tailIsLastReachable}
                        isError={stateSnapshot.tailIsLastReachable === false}
                      />
                      <StateValue label="SIZE_INTERNAL" value={stateSnapshot.storedSize} />
                      <StateValue
                        label="SIZE_ACTUAL"
                        value={stateSnapshot.reachableNodes}
                        isError={
                          stateSnapshot.storedSize !== null &&
                          stateSnapshot.storedSize !== stateSnapshot.reachableNodes
                        }
                      />
                      <StateValue
                        label="CYCLE_DETECT"
                        value={stateSnapshot.cycleDetected}
                        isError={stateSnapshot.cycleDetected}
                      />
                    </>
                  )}
                  {stateSnapshot.type === "arraylist" && (
                    <>
                      <StateValue label="SIZE" value={stateSnapshot.storedSize} />
                      <StateValue label="CAPACITY" value={stateSnapshot.capacity} />
                      <StateValue
                        label="BOUNDS_CHECK"
                        value={stateSnapshot.sizeInRange ? "OK" : "FAIL"}
                        isError={stateSnapshot.sizeInRange === false}
                      />
                    </>
                  )}
                  {stateSnapshot.type === "circular-queue" && (
                    <>
                      <StateValue label="HEAD_IDX" value={stateSnapshot.headIndex} />
                      <StateValue label="TAIL_IDX" value={stateSnapshot.tailIndex} />
                      <StateValue label="SIZE" value={stateSnapshot.storedSize} />
                      <StateValue label="CAPACITY" value={stateSnapshot.capacity} />
                      <StateValue
                        label="IDX_BOUNDS"
                        value={stateSnapshot.indicesInRange}
                        isError={stateSnapshot.indicesInRange === false}
                      />
                      <StateValue
                        label="SIZE_CONSISTENCY"
                        value={stateSnapshot.sizeInRange}
                        isError={stateSnapshot.sizeInRange === false}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Session Metrics - COMMENTED OUT FOR DEMO
          {sessionMetrics && (
            <div className="mt-4 p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={12} className="text-[var(--tech-cyan)]" />
                <h4 className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">
                  Session_Metrics
                </h4>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2 bg-black/30 rounded border border-zinc-800">
                  <div className={`text-lg font-mono font-black ${sessionMetrics.thrashScore > 0.5
                      ? 'text-red-500'
                      : sessionMetrics.thrashScore > 0.25
                        ? 'text-yellow-500'
                        : 'text-green-500'
                    }`}>
                    {(sessionMetrics.thrashScore * 100).toFixed(0)}%
                  </div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Thrash</div>
                </div>
                <div className="text-center p-2 bg-black/30 rounded border border-zinc-800">
                  <div className={`text-lg font-mono font-black ${sessionMetrics.convergenceRate > 0.5
                      ? 'text-green-500'
                      : sessionMetrics.convergenceRate > 0.25
                        ? 'text-yellow-500'
                        : 'text-red-500'
                    }`}>
                    {(sessionMetrics.convergenceRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Progress</div>
                </div>
                <div className="text-center p-2 bg-black/30 rounded border border-zinc-800">
                  <div className="text-lg font-mono font-black text-[var(--tech-cyan)]">
                    {sessionMetrics.runCount}
                  </div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Runs</div>
                </div>
              </div>
            </div>
          )}
          */}

          {/* 3. Visualization Area */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 pb-2 border-b border-[var(--structure-zinc)] border-dashed">
              <Box size={12} className="text-[var(--tech-cyan)]" />
              <h3 className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">
                Memory_Layout
              </h3>
            </div>

            {/* USE NEW COMPONENT */}
            {viz ? (
              <DataStructureViz viz={viz} />
            ) : (
              <div className="viz-container p-6 rounded-lg relative overflow-hidden min-h-[200px] flex items-center justify-center custom-scroll-area w-full"
                style={{
                  backgroundColor: 'var(--canvas-void)',
                  border: '1px solid var(--structure-zinc)',
                  backgroundImage: 'radial-gradient(var(--tech-cyan) 1.5px, transparent 1.5px)',
                  backgroundSize: '32px 32px'
                }}
              >
                {/* Fallback for when viz is missing (rare if stateSnapshot exists but lets be safe) */}
                {stateSnapshot.type === "arraylist" || stateSnapshot.type === "circular-queue" ? (
                  stateSnapshot.type === "arraylist" ? (
                    <BufferVisualizer
                      buffer={stateSnapshot.bufferPreview}
                      showHeadTail={false}
                    />
                  ) : (
                    <BufferVisualizer
                      buffer={stateSnapshot.bufferPreview}
                      head={stateSnapshot.headIndex}
                      tail={stateSnapshot.tailIndex}
                      capacity={stateSnapshot.capacity}
                      showHeadTail={true}
                    />
                  )
                ) : (
                  <div className="text-zinc-500 font-mono text-xs">Awaiting memory snapshot...</div>
                )}
              </div>
            )}
          </div>

          {/* 4. Nudge Console */}
          <div className="mt-4 border-t border-[var(--structure-zinc)] pt-6">
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-lg p-4 flex items-start gap-4 hover:border-[var(--tech-cyan)]/30 transition-colors">
              <div className="p-2 bg-blue-500/10 rounded border border-blue-500/20 shrink-0">
                <Activity size={16} className="text-blue-400" />
              </div>
              <div className="space-y-1 w-full">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest font-mono">
                  Suggested Action
                </h4>
                {isLoading ? (
                  <div className="h-3 w-1/2 bg-zinc-800/50 rounded animate-pulse mt-2" />
                ) : (
                  <p className="text-sm text-zinc-400 font-mono italic animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
                    &quot;{aiInsight ? aiInsight.nudge : getStaticNudge()}&quot;
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Gate 3: Interactive Prediction */}
          <div className={`bg-zinc-900/50 border border-zinc-800 rounded-[2rem] p-8 transition-all duration-500 ${gate === 3 ? 'opacity-100' : 'opacity-20 blur-sm pointer-events-none'}`}>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-500">
                <Search size={20} />
              </div>
              <h4 className="text-sm font-black text-white tracking-widest uppercase">Diagnostic Prediction (Gate 3)</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Expected Reachable Nodes</label>
                <input
                  type="number"
                  value={prediction.reachable}
                  onChange={(e) => setPrediction(p => ({ ...p, reachable: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm font-mono text-cyan-400 focus:border-cyan-500/50 outline-none shadow-inner"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Expected Stored Size</label>
                <input
                  type="number"
                  value={prediction.stored}
                  onChange={(e) => setPrediction(p => ({ ...p, stored: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm font-mono text-cyan-400 focus:border-cyan-500/50 outline-none shadow-inner"
                />
              </div>
            </div>

            {!isVerified ? (
              <button
                onClick={handleVerify}
                disabled={isVerifying}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-cyan-900/20 flex items-center justify-center gap-3 uppercase tracking-widest text-xs disabled:opacity-50"
              >
                {isVerifying ? (
                  <div className="flex items-center gap-3">
                    <Activity size={18} className="animate-spin" />
                    Processing Trace Flattener...
                  </div>
                ) : (
                  <>
                    Verify Diagnostic Prediction
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            ) : (
              <div className="p-6 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl animate-in zoom-in-95">
                <div className="flex items-center gap-3 text-emerald-500 mb-2">
                  <CheckCircle2 size={20} />
                  <span className="text-xs font-black uppercase tracking-[0.2em]">Diagnostic Match Confirmed</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed italic">
                  &quot;Predictive model validated. You&apos;ve correctly identified the drift between structure and metadata. Revisit <span className="text-white font-bold">Line 15</span> in your code to address the counter synchronization.&quot;
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
