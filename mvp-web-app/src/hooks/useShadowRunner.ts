"use client";

import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Result from running code in the shadow runner
 */
export interface ShadowRunResult {
  success: boolean;
  output: unknown;
  error?: string;
  stdout?: string;
  stderr?: string;
}

/**
 * Status of the shadow runner worker
 */
export type ShadowRunnerStatus = 
  | "idle"           // Ready to run code
  | "initializing"   // Pyodide is loading
  | "running"        // Code is executing
  | "terminated"     // Worker was killed (timeout/infinite loop)
  | "error";         // Worker failed to initialize

interface UseShadowRunnerOptions {
  /** Timeout in milliseconds before terminating the worker (default: 1000ms) */
  timeoutMs?: number;
  /** Whether to auto-initialize the worker on mount (default: true) */
  autoInit?: boolean;
}

interface UseShadowRunnerResult {
  /** Run Python code with the given inputs */
  run: (code: string, inputs?: unknown[]) => Promise<ShadowRunResult>;
  /** Current status of the worker */
  status: ShadowRunnerStatus;
  /** Whether the worker is ready to accept code */
  isReady: boolean;
  /** Whether code is currently running */
  isRunning: boolean;
  /** Manually initialize/restart the worker */
  restart: () => void;
  /** Terminate the worker immediately */
  terminate: () => void;
}

const WORKER_URL = "/workers/shadowRunner.worker.js";
const DEFAULT_TIMEOUT_MS = 1000;

/**
 * Hook to manage a Shadow Runner Web Worker for executing Python code.
 * 
 * The shadow runner is designed for quick, lightweight code execution.
 * It automatically terminates workers that exceed the timeout (to kill infinite loops)
 * and restarts them for subsequent runs.
 * 
 * @example
 * ```tsx
 * const { run, status, isReady } = useShadowRunner();
 * 
 * const handleRun = async () => {
 *   const result = await run('print(sum(inputs))', [1, 2, 3]);
 *   if (result.success) {
 *     console.log('Output:', result.output);
 *   } else {
 *     console.error('Error:', result.error);
 *   }
 * };
 * ```
 */
export function useShadowRunner(options: UseShadowRunnerOptions = {}): UseShadowRunnerResult {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, autoInit = true } = options;

  const [status, setStatus] = useState<ShadowRunnerStatus>("initializing");
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResolveRef = useRef<((result: ShadowRunResult) => void) | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Create and initialize a new worker
   */
  const createWorker = useCallback(() => {
    // Clean up existing worker if any
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      console.log("[useShadowRunner] Creating new worker");
      const worker = new Worker(WORKER_URL);

      worker.addEventListener("message", (event: MessageEvent<ShadowRunResult>) => {
        console.log("[useShadowRunner] Received message from worker:", event.data);

        // Clear timeout since we got a response
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        // Resolve pending promise
        if (pendingResolveRef.current) {
          pendingResolveRef.current(event.data);
          pendingResolveRef.current = null;
        }

        // Update status
        if (isMountedRef.current) {
          setStatus("idle");
        }
      });

      worker.addEventListener("error", (event: ErrorEvent) => {
        console.error("[useShadowRunner] Worker error:", event.message);

        // Clear timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        // Resolve with error
        if (pendingResolveRef.current) {
          pendingResolveRef.current({
            success: false,
            output: null,
            error: event.message || "Worker error",
          });
          pendingResolveRef.current = null;
        }

        if (isMountedRef.current) {
          setStatus("error");
        }
      });

      workerRef.current = worker;

      // Worker starts initializing Pyodide immediately
      // We consider it "idle" once it's created (Pyodide init happens in background)
      if (isMountedRef.current) {
        setStatus("idle");
      }

      console.log("[useShadowRunner] Worker created successfully");
    } catch (error) {
      console.error("[useShadowRunner] Failed to create worker:", error);
      if (isMountedRef.current) {
        setStatus("error");
      }
    }
  }, []);

  /**
   * Terminate the current worker
   */
  const terminate = useCallback(() => {
    console.log("[useShadowRunner] Terminating worker");

    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Terminate worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    // Resolve any pending promise with timeout error
    if (pendingResolveRef.current) {
      pendingResolveRef.current({
        success: false,
        output: null,
        error: "Execution timed out (possible infinite loop)",
      });
      pendingResolveRef.current = null;
    }

    if (isMountedRef.current) {
      setStatus("terminated");
    }
  }, []);

  /**
   * Restart the worker (creates a fresh instance)
   */
  const restart = useCallback(() => {
    console.log("[useShadowRunner] Restarting worker");
    createWorker();
  }, [createWorker]);

  /**
   * Run Python code with the given inputs
   */
  const run = useCallback(
    async (code: string, inputs: unknown[] = []): Promise<ShadowRunResult> => {
      // If worker was terminated or errored, restart it first
      if (!workerRef.current || status === "terminated" || status === "error") {
        console.log("[useShadowRunner] Worker not available, restarting...");
        createWorker();
        
        // Give the worker a moment to initialize
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!workerRef.current) {
        return {
          success: false,
          output: null,
          error: "Worker failed to initialize",
        };
      }

      // Update status
      setStatus("running");

      return new Promise<ShadowRunResult>((resolve) => {
        // Store resolve function for the message handler
        pendingResolveRef.current = resolve;

        // Set timeout to kill infinite loops
        timeoutRef.current = setTimeout(() => {
          console.log(`[useShadowRunner] Timeout after ${timeoutMs}ms, terminating worker`);
          terminate();
          
          // Restart worker for next run
          console.log("[useShadowRunner] Auto-restarting worker after timeout");
          createWorker();
        }, timeoutMs);

        // Send code to worker
        console.log("[useShadowRunner] Sending code to worker");
        workerRef.current!.postMessage({ code, inputs });
      });
    },
    [status, timeoutMs, terminate, createWorker]
  );

  // Initialize worker on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (autoInit) {
      createWorker();
    }

    return () => {
      isMountedRef.current = false;

      // Cleanup on unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [autoInit, createWorker]);

  const isReady = status === "idle";
  const isRunning = status === "running";

  return {
    run,
    status,
    isReady,
    isRunning,
    restart,
    terminate,
  };
}
