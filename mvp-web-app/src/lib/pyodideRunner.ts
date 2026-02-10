// Import polyfills first to ensure browser compatibility
import './polyfills';

import { RunResponse, TestCase } from './runner-contract';
import { pyodideWorkerCode } from './pyodideWorkerCode';
import { PYODIDE_BASE_URL } from './pyodideConfig';

let worker: Worker | null = null;
let workerReady = false;
let initPromise: Promise<void> | null = null;
let bootStartTime: number | null = null;
let workerRetryCount = 0;
const MAX_WORKER_RETRIES = 3;

interface WorkerMessage {
  cmd: 'INIT' | 'PING' | 'RUN';
  reqId?: string;
  indexURL?: string;
  nonce?: string;
  code?: string;
  testCases?: TestCase[];
  timeoutMs?: number;
  memLimitMB?: number;
}

interface WorkerResponse {
  cmd: 'READY' | 'ACK' | 'RESULT' | 'ERROR';
  reqId?: string;
  nonce?: string;
  data?: RunResponse;
  error?: string;
  pyodide_init_ms?: number;
}

import { detectBrowser } from './utils/browserDetection';

let lastPyodideInitMs: number | null = null;

export function getLastPyodideInitMs(): number | null {
  return lastPyodideInitMs;
}

export function supportsHardTimeouts(): boolean {
  if (typeof SharedArrayBuffer !== 'undefined') {
    return true;
  }

  // Allow Safari on desktop even if SharedArrayBuffer is missing
  // (It won't support hard timeouts, but will run)
  if (typeof window !== 'undefined') {
    const { browser, deviceType } = detectBrowser();
    if (browser === 'Safari' && deviceType === 'Desktop') {
      return true;
    }
  }

  return false;
}

async function createWorker(): Promise<Worker> {
  console.log('[PyodideRunner] Creating new worker from inline code...');

  let newWorker: Worker;

  try {
    // Create worker from inline code using Blob URL
    // This avoids Next.js compilation issues with TypeScript workers
    const blob = new Blob([pyodideWorkerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    console.log('[PyodideRunner] Worker Blob URL created:', workerUrl);

    // Create worker from Blob URL
    newWorker = new Worker(workerUrl);
    console.log('[PyodideRunner] Worker object created successfully (from Blob)');
  } catch (constructError) {
    console.error('[PyodideRunner] Failed to construct Worker:', constructError);
    throw constructError;
  }

  // Set up error handling for worker crashes
  newWorker.addEventListener('error', (error: ErrorEvent) => {
    console.error('[PyodideRunner] Worker error event:', {
      message: error.message,
      filename: error.filename,
      lineno: error.lineno,
      colno: error.colno,
      error: error.error,
      type: error.type
    });

    workerReady = false;
    worker = null;
    initPromise = null;
    lastPyodideInitMs = null;

    if (workerRetryCount < MAX_WORKER_RETRIES) {
      workerRetryCount++;
      console.log(`Worker crashed, retrying (${workerRetryCount}/${MAX_WORKER_RETRIES})...`);
      // Don't auto-retry here, let the next call to initWorker handle it
    } else {
      console.error('Worker failed after maximum retries');
    }
  });

  newWorker.addEventListener('messageerror', (error) => {
    console.error('[PyodideRunner] Worker message error:', error);
    workerReady = false;
    worker = null;
    initPromise = null;
    lastPyodideInitMs = null;
  });

  return newWorker;
}

export async function initWorker(): Promise<void> {
  if (initPromise) {
    console.log('[PyodideRunner] Worker already initializing or initialized, reusing promise');
    return initPromise;
  }

  console.log('[PyodideRunner] Starting worker initialization...');

  // Reset retry count on successful init
  workerRetryCount = 0;

  initPromise = new Promise<void>(async (resolve, reject) => {
    try {
      bootStartTime = Date.now();

      // Create worker with proper URL handling for Next.js
      console.log('[PyodideRunner] About to create worker...');
      worker = await createWorker();
      console.log('[PyodideRunner] Worker created, setting up timeout and handlers...');

      const initTimeout = setTimeout(() => {
        console.error('[PyodideRunner] Worker initialization timed out after 20s');
        reject(new Error('Worker initialization timeout'));
      }, 20000); // 20s timeout for init

      const handleMessage = (event: MessageEvent<WorkerResponse>) => {
        console.log('[PyodideRunner] Received message from worker:', event.data);

        if (event.data.cmd === 'READY') {
          clearTimeout(initTimeout);
          worker?.removeEventListener('message', handleMessage);
          workerReady = true;

          const bootDuration = bootStartTime ? Date.now() - bootStartTime : 0;
          console.log('[PyodideRunner] Worker ready! Boot time:', bootDuration, 'ms');

          if (event.data.pyodide_init_ms) {
            lastPyodideInitMs = event.data.pyodide_init_ms;
            console.log('[PyodideRunner] Received init duration from worker:', lastPyodideInitMs, 'ms');
          }

          resolve();
        } else if (event.data.cmd === 'ERROR') {
          clearTimeout(initTimeout);
          worker?.removeEventListener('message', handleMessage);
          console.error('[PyodideRunner] Worker sent ERROR during init:', event.data.error);
          reject(new Error(event.data.error || 'Worker initialization failed'));
        }
      };

      worker.addEventListener('message', handleMessage);
      console.log('[PyodideRunner] Message handler attached');

      // Send init message
      const initMsg: WorkerMessage = {
        cmd: 'INIT',
        reqId: generateId(),
        indexURL: PYODIDE_BASE_URL
      };
      console.log('[PyodideRunner] Sending INIT message to worker:', initMsg);
      worker.postMessage(initMsg);
      console.log('[PyodideRunner] INIT message sent, waiting for READY...');

    } catch (error) {
      console.error('[PyodideRunner] Error during worker initialization:', error);
      reject(error);
    }
  });

  return initPromise;
}

export async function ping(): Promise<boolean> {
  if (!worker || !workerReady) {
    await initWorker();
  }

  return new Promise<boolean>((resolve) => {
    const nonce = generateId();
    const timeout = setTimeout(() => {
      resolve(false);
    }, 1000);

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.cmd === 'ACK' && event.data.nonce === nonce) {
        clearTimeout(timeout);
        worker?.removeEventListener('message', handleMessage);
        resolve(true);
      }
    };

    worker!.addEventListener('message', handleMessage);

    const pingMsg: WorkerMessage = {
      cmd: 'PING',
      nonce
    };
    worker!.postMessage(pingMsg);
  });
}

export async function runInWorker(
  code: string,
  tests: TestCase[],
  limits?: { timeoutMs?: number; memLimitMB?: number }
): Promise<RunResponse> {
  // Input validation
  if (!code || code.trim() === '') {
    throw new Error('Code cannot be empty');
  }

  if (!tests || tests.length === 0) {
    throw new Error('At least one test case is required');
  }

  // Validate test cases
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    if (!test.fn || test.fn.trim() === '') {
      console.error('[BUG] Test case missing function name:', test);
      throw new Error(`Test case ${i} is missing 'fn' field (function name). This is likely a bug in question setup.`);
    }
    if (test.args === undefined) {
      console.warn(`[WARN] Test case ${i} missing 'args' field, using empty array`);
      test.args = [];
    }
  }

  console.log('[PyodideRunner] Running code with', tests.length, 'test cases');
  console.log('[PyodideRunner] First test:', tests[0]);

  if (!worker || !workerReady) {
    await initWorker();
  }

  return new Promise<RunResponse>(async (resolve, reject) => {
    const reqId = generateId();
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      // Instead of rejecting, we resolve with a TIMEOUT response + synthetic Viz
      // so the debugger can show "Infinite Loop" state.
      console.warn('[PyodideRunner] Worker execution timeout - resolving with synth viz');
      resolve({
        stdout: '',
        stderr: 'Execution timed out (Possible infinite loop)',
        exitCode: 124, // EXIT_TIMEOUT
        reason: 'TIMEOUT',
        testSummary: {
          total: 1,
          passed: 0,
          failed: 1,
          cases: [{
            fn: 'timeout_check', // Dummy name
            passed: false,
            durationMs: (limits?.timeoutMs || 2000),
            error: 'Execution timed out (Possible infinite loop)',
            errorCode: 'TIMEOUT'
          }]
        },
        viz: {
          diagramType: 'linked-list', // Heuristic: effective for this problem
          structure: { nodes: [], nextPointers: [] },
          markers: { cycleDetected: true },
          stateSnapshot: {
            type: 'linked-list',
            cycleDetected: true,
            headExists: true
          }
        }
      });
    }, (limits?.timeoutMs || 2000) + 5000); // Add 5s buffer for worker overhead

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.reqId === reqId) {
        clearTimeout(timeout);
        worker?.removeEventListener('message', handleMessage);

        const duration = Date.now() - startTime;
        // Track duration - removed, use telemetryClient instead

        if (event.data.cmd === 'RESULT' && event.data.data) {
          const result = event.data.data;

          // Track test results - removed, use telemetryClient instead

          resolve(result);
        } else if (event.data.cmd === 'ERROR') {
          reject(new Error(event.data.error || 'Worker execution failed'));
        }
      }
    };

    const handleError = async (error: ErrorEvent) => {
      clearTimeout(timeout);
      worker?.removeEventListener('message', handleMessage);
      worker?.removeEventListener('error', handleError);

      // Try to recover with a new worker
      if (workerRetryCount < MAX_WORKER_RETRIES) {
        console.log('Worker crashed during execution, attempting recovery...');
        workerReady = false;
        worker = null;
        initPromise = null;

        try {
          await initWorker();
          // Retry the execution
          const retryResult = await runInWorker(code, tests, limits);
          resolve(retryResult);
        } catch (retryError) {
          reject(new Error(`Worker crashed and recovery failed: ${retryError}`));
        }
      } else {
        reject(new Error(`Worker crashed after maximum retries: ${error.message}`));
      }
    };

    worker!.addEventListener('message', handleMessage);
    worker!.addEventListener('error', handleError);

    const runMsg: WorkerMessage = {
      cmd: 'RUN',
      reqId,
      code,
      testCases: tests,
      timeoutMs: limits?.timeoutMs || 2000,
      memLimitMB: limits?.memLimitMB || 128
    };

    try {
      worker!.postMessage(runMsg);
    } catch (error) {
      clearTimeout(timeout);
      worker?.removeEventListener('message', handleMessage);
      worker?.removeEventListener('error', handleError);
      reject(new Error(`Failed to send message to worker: ${error}`));
    }
  });
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Telemetry removed - use telemetryClient.ts instead