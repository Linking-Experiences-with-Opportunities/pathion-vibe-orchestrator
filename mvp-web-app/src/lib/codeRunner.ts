import { RunResponse, TestCase, TestCaseResult } from "./runner-contract";
import { initWorker, runInWorker, supportsHardTimeouts, getLastPyodideInitMs } from "./pyodideRunner";
import { trackRunnerResult } from "./telemetryClient";
import { flags } from "./flags";
import { mapPythonError, UniversalErrorCode } from "./errorCodeMapper";

export { supportsHardTimeouts as isRunnerSupported } from "./pyodideRunner";

const CF_RUNNER_URL = (process.env.NEXT_PUBLIC_CF_RUNNER_URL || "").replace(/\/$/, "");

async function runOnServer(
  code: string,
  tests: TestCase[],
  opts?: { timeoutMs?: number; memLimitMB?: number; problemId?: string; hasHiddenTests?: boolean }
): Promise<RunResponse> {
  if (!CF_RUNNER_URL) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Server runner URL not configured",
      reason: "RUNTIME_ERROR",
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  try {
    const response = await fetch(`${CF_RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: "python",
        code,
        tests,
        limits: {
          timeoutMs: opts?.timeoutMs,
          memoryMB: opts?.memLimitMB,
        },
      }),
    });

    const duration = Date.now() - startTime;
    if (!response.ok) {
      const text = await response.text();
      return {
        exitCode: 1,
        stdout: "",
        stderr: text || `Server runner error: ${response.status}`,
        reason: "RUNTIME_ERROR",
        durationMs: duration,
      };
    }

    const data = (await response.json()) as RunResponse;
    return {
      ...data,
      durationMs: data.durationMs ?? duration,
      ttfrMs: data.ttfrMs ?? duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Server runner request failed",
      reason: "RUNTIME_ERROR",
      durationMs: duration,
    };
  }
}

export async function runCode(
  code: string,
  tests: TestCase[],
  opts?: { timeoutMs?: number; memLimitMB?: number; problemId?: string; hasHiddenTests?: boolean }
): Promise<RunResponse> {
  const hasHiddenTests = opts?.hasHiddenTests || false;

  // Determine execution path based on flags and hidden tests
  const shouldUseServer = flags.forceServer || (hasHiddenTests && !flags.FORCE_LOCAL);
  const shouldUseBrowser = !shouldUseServer && supportsHardTimeouts();

  // If server is required but browser execution forced, log warning
  if (hasHiddenTests && flags.FORCE_LOCAL) {
    console.warn('[runner] FORCE_LOCAL enabled but problem has hidden tests - using browser for public tests only');
  }

  // Check if browser execution is supported when needed
  if (!shouldUseServer && !supportsHardTimeouts()) {
    console.info('[runner] browser unsupported, no server fallback available');
    const unsupportedResponse: RunResponse = {
      exitCode: 1,
      stdout: "",
      stderr: "Code execution requires a desktop browser. Please use Chrome, Firefox, Safari, or Edge on a desktop computer.",
      reason: "BROWSER_UNSUPPORTED",
      durationMs: 0,
    };

    await trackRunnerResult({
      exitCode: unsupportedResponse.exitCode,
      reason: unsupportedResponse.reason,
      durationMs: 0,
      mode: "browser",
      problemId: opts?.problemId,
    });

    return unsupportedResponse;
  }

  // Execute on server
  if (shouldUseServer) {
    console.info('[runner] server start', { problemId: opts?.problemId, testCount: tests.length });
    const startTime = Date.now();
    const res = await runOnServer(code, tests, opts);
    const duration = Date.now() - startTime;

    console.info('[runner] server end', {
      exitCode: res.exitCode,
      durationMs: duration,
      passed: res.testSummary?.passed,
      total: res.testSummary?.total
    });

    await trackRunnerResult({
      exitCode: res.exitCode,
      reason: res.reason,
      durationMs: res.durationMs ?? duration,
      testsPassed: res.testSummary?.passed,
      testsTotal: res.testSummary?.total,
      mode: "server",
      problemId: opts?.problemId,
    });

    if (typeof window !== 'undefined') {
      (window as any).__updateRunnerStatus?.({
        path: 'server',
        exitCode: res.exitCode,
        reason: res.reason,
        durationMs: res.durationMs ?? duration,
        ttfrMs: res.ttfrMs ?? duration,
      });
    }

    return {
      ...res,
      ttfrMs: res.ttfrMs ?? duration,
    };
  }

  // Execute locally in browser
  if (shouldUseBrowser) {
    console.info('[runner] local start', { problemId: opts?.problemId, testCount: tests.length });
    console.log('[runner] User code to execute:\n', code.substring(0, 300) + (code.length > 300 ? '...' : ''));
    console.log('[runner] Test cases:', tests);
    const startTime = Date.now();

    try {
      await initWorker();
      const res = await runInWorker(code, tests, opts);
      const duration = Date.now() - startTime;

      console.info('[runner] local end', {
        exitCode: res.exitCode,
        durationMs: duration,
        passed: res.testSummary?.passed,
        total: res.testSummary?.total
      });

      // Track telemetry
      // Track telemetry
      const pyodideInitMs = getLastPyodideInitMs();

      await trackRunnerResult({
        exitCode: res.exitCode,
        reason: res.reason,
        durationMs: duration,
        testsPassed: res.testSummary?.passed,
        testsTotal: res.testSummary?.total,
        mode: "browser",
        problemId: opts?.problemId,
        pyodide_init_ms: pyodideInitMs || undefined
      });

      // Update runner status panel
      if (typeof window !== 'undefined') {
        (window as any).__updateRunnerStatus?.({
          path: 'browser',
          exitCode: res.exitCode,
          reason: res.reason,
          durationMs: duration,
          ttfrMs: duration,
        });
      }

      return {
        ...res,
        ttfrMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('[runner] local error', error);

      // Return error response
      const errorResponse: RunResponse = {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown error occurred",
        reason: "RUNTIME_ERROR",
        durationMs: duration,
      };

      await trackRunnerResult({
        exitCode: errorResponse.exitCode,
        reason: errorResponse.reason,
        durationMs: duration,
        mode: "browser",
        problemId: opts?.problemId,
      });

      return errorResponse;
    }
  }

  // This path should not be reached in browser-first mode
  // Server verification for hidden tests is handled separately
  console.warn('[runner] unexpected code path - neither browser nor server execution configured');
  return {
    exitCode: 1,
    stdout: "",
    stderr: "Execution path not configured",
    reason: "RUNTIME_ERROR",
    durationMs: 0,
  };
}

// Helper to convert RunResponse to simpler format for problem pages
export function convertToTestResults(runResponse: RunResponse): any[] {
  if (!runResponse.testSummary) return [];

  return runResponse.testSummary.cases.map((testCase, index) => {
    // Determine test status for error mapping
    const status: 'pass' | 'fail' | 'error' = testCase.passed
      ? 'pass'
      : (testCase.error?.includes('Error') || testCase.error?.includes('Exception'))
        ? 'error'
        : 'fail';

    // Map to universal error code with tooltip
    const errorInfo = mapPythonError(
      status,
      testCase.error,
      runResponse.stderr,
      testCase.durationMs
    );

    return {
      name: testCase.fn || `Test ${index + 1}`,
      expected: testCase.expected,
      actual: testCase.received,
      passed: testCase.passed,
      printed: testCase.error || "",
      errorCode: errorInfo.code,
      errorTooltip: errorInfo.tooltip,
    };
  });
}
