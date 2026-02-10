"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { DebugStep, DebugStackFrame } from "@/components/CodeEditor/types";

const WORKER_URL = "/workers/debugWorker.worker.js";

/** Max steps before the tracer auto-truncates. */
const DEFAULT_MAX_STEPS = 2000;

/** Breakpoints map: { [filename]: Set<lineNumber> } */
export type BreakpointsMap = Record<string, Set<number>>;

export interface UseStepDebuggerResult {
  /** The DebugStep currently being viewed, or undefined if not debugging. */
  step: DebugStep | undefined;
  /** Start a debug trace of single-file code (problems). */
  startDebug: (code: string) => void;
  /** Start a debug trace of multi-file project code. */
  startDebugMulti: (files: Record<string, string>, entryFile: string) => void;
  /** Advance to the next step. */
  onStepOver: () => void;
  /** Jump back to step 0. */
  onRestart: () => void;
  /** Exit debug mode and discard the trace. */
  onStop: () => void;
  /** Skip forward to the next step matching any breakpoint. If none, jump to end. */
  onContinue: (breakpoints: BreakpointsMap) => void;
  /** True when the last step has been reached. */
  isFinished: boolean;
  /** True while the worker is running the trace. */
  isTracing: boolean;
  /** Current 0-based step index. */
  stepIndex: number;
  /** Total number of steps in the trace. */
  totalSteps: number;
  /** Whether the trace was truncated at maxSteps. */
  truncated: boolean;
  /** Error from tracing, if any. */
  error: string | null;
  /** True when the debugger has an active trace loaded (step mode is on). */
  isActive: boolean;
  /** The source line number of the current step (for editor highlighting). */
  currentLine: number | undefined;
  /** The filename of the current step (for multi-file auto-switching). */
  currentFile: string | undefined;
}

interface WorkerMessage {
  cmd: "READY" | "TRACE_RESULT" | "ERROR";
  steps?: RawStep[];
  truncated?: boolean;
  error?: string | null;
}

interface RawStackFrame {
  fn: string;
  file?: string | null;
  line?: number;
}

interface RawStep {
  file?: string | null;
  line: number;
  stack: RawStackFrame[] | string[];
  variables: Record<string, unknown>;
  output: string;
}

/**
 * Convert a raw step from the worker into a DebugStep for the UI.
 * Handles both old (string[]) and new (RawStackFrame[]) stack formats.
 */
function toDebugStep(raw: RawStep): DebugStep {
  let stack: DebugStackFrame[];

  if (raw.stack.length > 0 && typeof raw.stack[0] === "object") {
    // New rich format
    stack = (raw.stack as RawStackFrame[]).map((f) => ({
      fn: f.fn,
      file: f.file ?? undefined,
      line: f.line,
    }));
  } else {
    // Legacy string[] format
    stack = (raw.stack as string[]).map((name) => ({ fn: name }));
  }

  return {
    file: raw.file ?? undefined,
    line: raw.line,
    stack,
    variables: raw.variables as Record<string, any>,
    output: raw.output,
  };
}

/**
 * React hook that manages a dedicated Debug Worker for step-through tracing.
 *
 * Supports both single-file (problems) and multi-file (projects) debugging.
 */
export function useStepDebugger(): UseStepDebuggerResult {
  // ── Worker lifecycle ──────────────────────────────────────────
  const workerRef = useRef<Worker | null>(null);
  const stepsRef = useRef<RawStep[]>([]);

  // ── State ─────────────────────────────────────────────────────
  const [stepIndex, setStepIndex] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [isTracing, setIsTracing] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────
  const isFinished = isActive && totalSteps > 0 && stepIndex >= totalSteps - 1;
  const step: DebugStep | undefined =
    isActive && stepsRef.current.length > 0
      ? toDebugStep(stepsRef.current[stepIndex])
      : undefined;

  // ── Worker init (lazy) ────────────────────────────────────────
  const getWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(WORKER_URL);

    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;

      if (msg.cmd === "TRACE_RESULT") {
        const steps = msg.steps ?? [];
        stepsRef.current = steps;
        setTotalSteps(steps.length);
        setStepIndex(0);
        setTruncated(msg.truncated ?? false);
        setError(msg.error ?? null);
        setIsTracing(false);
        setIsActive(steps.length > 0);
      }

      if (msg.cmd === "ERROR") {
        setError(msg.error ?? "Unknown worker error");
        setIsTracing(false);
      }
    });

    worker.addEventListener("error", (event) => {
      console.error("[useStepDebugger] Worker error:", event);
      setError(event.message || "Worker crashed");
      setIsTracing(false);
    });

    workerRef.current = worker;
    return worker;
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Shared reset logic ────────────────────────────────────────
  const resetState = useCallback(() => {
    stepsRef.current = [];
    setStepIndex(0);
    setTotalSteps(0);
    setTruncated(false);
    setError(null);
    setIsActive(false);
    setIsTracing(true);
  }, []);

  // ── Public API ────────────────────────────────────────────────

  /** Single-file debug (problems). */
  const startDebug = useCallback(
    (code: string) => {
      const worker = getWorker();
      resetState();
      worker.postMessage({
        cmd: "DEBUG",
        code,
        maxSteps: DEFAULT_MAX_STEPS,
      });
    },
    [getWorker, resetState]
  );

  /** Multi-file debug (projects). */
  const startDebugMulti = useCallback(
    (files: Record<string, string>, entryFile: string) => {
      const worker = getWorker();
      resetState();
      worker.postMessage({
        cmd: "DEBUG_MULTI",
        files,
        entryFile,
        maxSteps: DEFAULT_MAX_STEPS,
      });
    },
    [getWorker, resetState]
  );

  const onStepOver = useCallback(() => {
    setStepIndex((prev) => Math.min(prev + 1, stepsRef.current.length - 1));
  }, []);

  const onRestart = useCallback(() => {
    setStepIndex(0);
  }, []);

  const onStop = useCallback(() => {
    stepsRef.current = [];
    setStepIndex(0);
    setTotalSteps(0);
    setIsActive(false);
    setTruncated(false);
    setError(null);
  }, []);

  /** Skip forward to the next step matching any breakpoint. */
  const onContinue = useCallback((breakpoints: BreakpointsMap) => {
    const steps = stepsRef.current;
    const hasAnyBreakpoints = Object.values(breakpoints).some((s) => s.size > 0);

    if (!hasAnyBreakpoints) {
      // No breakpoints set: jump to the last step
      setStepIndex(steps.length - 1);
      return;
    }

    setStepIndex((prev) => {
      for (let i = prev + 1; i < steps.length; i++) {
        const s = steps[i];
        const file = s.file ?? "";
        const lineSet = breakpoints[file];
        if (lineSet && lineSet.has(s.line)) {
          return i;
        }
      }
      // No more breakpoints ahead: jump to end
      return steps.length - 1;
    });
  }, []);

  const currentLine = step?.line;
  const currentFile = step?.file;

  return {
    step,
    startDebug,
    startDebugMulti,
    onStepOver,
    onRestart,
    onStop,
    onContinue,
    isFinished,
    isTracing,
    stepIndex,
    totalSteps,
    truncated,
    error,
    isActive,
    currentLine,
    currentFile,
  };
}
