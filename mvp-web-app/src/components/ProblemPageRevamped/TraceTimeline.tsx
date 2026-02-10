"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ExecutionSnapshot } from "@/hooks/useExecutionHistory";
import { diffSnapshots, TestDiff } from "@/lib/snapshotDiff";
import { AlertTriangle, ChevronRight, Clock, ArrowRight, CheckCircle2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface TraceTimelineProps {
  history: ExecutionSnapshot[];
  testCases?: { name: string }[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}

// ─── TimelineScrubber ───────────────────────────────────────────────

interface TimelineScrubberProps {
  history: ExecutionSnapshot[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function TimelineScrubber({ history, selectedIndex, onSelect }: TimelineScrubberProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep selected dot visible
  useEffect(() => {
    if (scrollRef.current) {
      const container = scrollRef.current;
      const dot = container.children[selectedIndex] as HTMLElement;
      if (dot) {
        const containerRect = container.getBoundingClientRect();
        const dotRect = dot.getBoundingClientRect();
        if (dotRect.left < containerRect.left || dotRect.right > containerRect.right) {
          dot.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }
    }
  }, [selectedIndex]);

  return (
    <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto scrollbar-thin" ref={scrollRef}>
      {history.map((snap, idx) => {
        const isSelected = idx === selectedIndex;
        const dotColor = snap.terminated
          ? "bg-yellow-500"
          : snap.success
            ? "bg-emerald-500"
            : "bg-red-500";

        return (
          <React.Fragment key={snap.id}>
            {idx > 0 && (
              <div className="w-3 h-px bg-zinc-700 shrink-0" />
            )}
            <button
              onClick={() => onSelect(idx)}
              className={`shrink-0 rounded-full transition-all ${isSelected
                  ? `w-3.5 h-3.5 ring-2 ring-offset-1 ring-offset-zinc-900 ${snap.terminated
                    ? "ring-yellow-400"
                    : snap.success
                      ? "ring-emerald-400"
                      : "ring-red-400"
                  }`
                  : "w-2.5 h-2.5 hover:scale-125"
                } ${dotColor}`}
              title={`Run #${snap.runNumber} - ${snap.success ? "All passed" : snap.terminated ? "Timed out" : `${snap.failCount} failed`}`}
              aria-label={`Select run ${snap.runNumber}`}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── SnapshotDiffView ───────────────────────────────────────────────

interface SnapshotDiffViewProps {
  snapshot: ExecutionSnapshot;
  prevSnapshot: ExecutionSnapshot | null;
  diffs: TestDiff[];
}

function SnapshotDiffView({ snapshot, prevSnapshot, diffs }: SnapshotDiffViewProps) {
  const timeAgo = useMemo(() => {
    const delta = Date.now() - snapshot.timestamp;
    if (delta < 1000) return "just now";
    if (delta < 60000) return `${Math.round(delta / 1000)}s ago`;
    if (delta < 3600000) return `${Math.round(delta / 60000)}m ago`;
    return `${Math.round(delta / 3600000)}h ago`;
  }, [snapshot.timestamp]);

  const hasRegressions = diffs.some((d) => d.regression);
  const hasFixes = diffs.some((d) => d.fixed);

  return (
    <div className="px-3 py-2 space-y-3">
      {/* Run metadata */}
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-200">Run #{snapshot.runNumber}</span>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {timeAgo}
        </span>
        <span>{snapshot.durationMs}ms</span>
        <span className={snapshot.success ? "text-emerald-400" : "text-red-400"}>
          {snapshot.passCount}/{snapshot.results.length} passed
        </span>
      </div>

      {/* Regression / Fix badges */}
      {hasRegressions && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-red-950/30 border border-red-800/50 rounded text-xs text-red-300">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          Regression detected
        </div>
      )}
      {hasFixes && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-emerald-950/30 border border-emerald-800/50 rounded text-xs text-emerald-300">
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          Test(s) fixed
        </div>
      )}

      {/* Per-test diffs */}
      <div className="space-y-2">
        {diffs.map((diff) => (
          <div
            key={diff.testName}
            className={`p-2 rounded border text-xs ${diff.regression
                ? "border-red-800/50 bg-red-950/20"
                : diff.fixed
                  ? "border-emerald-800/50 bg-emerald-950/20"
                  : diff.changed
                    ? "border-yellow-800/50 bg-yellow-950/10"
                    : "border-zinc-800/50 bg-zinc-900/20"
              }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-zinc-200">{diff.testName}</span>
              {diff.regression && (
                <span className="px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded text-[10px] font-semibold">
                  REGRESSION
                </span>
              )}
              {diff.fixed && (
                <span className="px-1.5 py-0.5 bg-emerald-900/50 text-emerald-300 rounded text-[10px] font-semibold">
                  FIXED
                </span>
              )}
            </div>

            {prevSnapshot && diff.changed && (
              <div className="flex items-center gap-2 text-zinc-400 font-mono mt-1">
                <span className={diff.regression ? "text-red-400" : "text-zinc-400"}>
                  {formatOutput(diff.previousOutput)}
                </span>
                <ArrowRight size={12} className="text-zinc-600 shrink-0" />
                <span className={diff.fixed ? "text-emerald-400" : diff.regression ? "text-red-300" : "text-zinc-300"}>
                  {formatOutput(diff.currentOutput)}
                </span>
              </div>
            )}

            {!prevSnapshot && (
              <div className="text-zinc-500 font-mono mt-1">
                {formatOutput(diff.currentOutput)}
              </div>
            )}

            {prevSnapshot && !diff.changed && (
              <div className="text-zinc-600 mt-1 italic">
                No change
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatOutput(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── TraceTimeline (main export) ────────────────────────────────────

export function TraceTimeline({ history, testCases, selectedIndex: controlledIndex, onSelect }: TraceTimelineProps) {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number>(history.length - 1);

  const isControlled = controlledIndex !== undefined;
  const selectedIndex = isControlled ? controlledIndex : internalSelectedIndex;

  const handleSelectionChange = useCallback((index: number) => {
    if (isControlled && onSelect) {
      onSelect(index);
    } else {
      setInternalSelectedIndex(index);
    }
  }, [isControlled, onSelect]);

  // Shim setSelectedIndex to support functional updates or direct values, for compatibility with existing code
  const setSelectedIndex = useCallback((value: number | ((prev: number) => number)) => {
    let newIndex: number;
    if (typeof value === 'function') {
      newIndex = value(selectedIndex);
    } else {
      newIndex = value;
    }
    handleSelectionChange(newIndex);
  }, [selectedIndex, handleSelectionChange]);

  // Keep internal selectedIndex in bounds when history changes
  useEffect(() => {
    if (!isControlled) {
      if (history.length === 0) {
        setInternalSelectedIndex(0);
      } else if (internalSelectedIndex >= history.length) {
        setInternalSelectedIndex(history.length - 1);
      } else if (internalSelectedIndex < 0) {
        setInternalSelectedIndex(0);
      }
    }
  }, [history.length, internalSelectedIndex, isControlled]);

  // Auto-select latest run when new snapshots arrive (only for uncontrolled)
  useEffect(() => {
    if (!isControlled && history.length > 0) {
      setInternalSelectedIndex(history.length - 1);
    }
  }, [history.length, isControlled]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(history.length - 1, prev + 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setSelectedIndex(history.length - 1);
      }
    },
    [history.length]
  );

  // Empty state
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
          <Clock className="w-6 h-6 text-zinc-500" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-1">No Execution History</h3>
        <p className="text-xs text-zinc-500 max-w-xs">
          Start writing code. The trace timeline will record each valid execution automatically.
        </p>
      </div>
    );
  }

  const selectedSnapshot = history[selectedIndex];
  const prevSnapshot = selectedIndex > 0 ? history[selectedIndex - 1] : null;
  const diffs = diffSnapshots(prevSnapshot, selectedSnapshot);

  return (
    <div
      className="flex flex-col h-full bg-zinc-950/30"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Trace Timeline"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50">
        <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2">
          <ChevronRight size={12} />
          Trace Timeline
        </span>
        <span className="text-xs text-zinc-500">
          Run {selectedSnapshot.runNumber} of {history[history.length - 1].runNumber}
        </span>
      </div>

      {/* Scrubber */}
      <div className="border-b border-zinc-800/50">
        <TimelineScrubber
          history={history}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
        />
        <div className="px-3 pb-1 text-[10px] text-zinc-600 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> pass
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> fail
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" /> timeout
          </span>
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <SnapshotDiffView
          snapshot={selectedSnapshot}
          prevSnapshot={prevSnapshot}
          diffs={diffs}
        />
      </div>
    </div>
  );
}
