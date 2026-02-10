// Exit codes (align with backend)
export const EXIT_OK = 0;
export const EXIT_TIMEOUT = 124;
export const EXIT_MEMORY = 137;
export const EXIT_ERROR = 1;

export type FailureReason =
  | "TIMEOUT"
  | "MEMORY"
  | "IMPORT_FAIL"
  | "PACKAGE_POLICY"
  | "BROWSER_UNSUPPORTED"
  | "COMPILATION_ERROR"
  | "RUNTIME_ERROR"
  | null;

export type TestCase = {
  id?: string;
  fn: string; // Function name to call (required for type safety, but Python handles missing gracefully)
  className?: string; // Class name for class-based problems (e.g., "Solution")
  args?: any[];
  expected?: any; // optional => if omitted, treat as 'assert returns without error'
};

export type TestCaseResult = {
  id?: string;
  fn: string;
  passed: boolean;
  received?: any;
  expected?: any;
  durationMs: number;
  error?: string;
  /** Backend/runner error code (e.g. TIMEOUT, COMPILATION_ERROR, RUNTIME_ERROR). Use for deterministic categorization when present. */
  errorCode?: string | null;
};

export type TestSummary = {
  total: number;
  passed: number;
  failed: number;
  cases: TestCaseResult[];
};

export type VizPayload = {
  diagramType: string;
  structure: Record<string, any>;
  markers: Record<string, any>;
  truncated?: boolean;
  stateSnapshot?: Record<string, any>;
};

export type RunResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
  testSummary?: TestSummary;
  durationMs?: number;
  ttfrMs?: number;
  reason?: FailureReason;
  meta?: Record<string, any>;
  /** Structured viz payload extracted by the worker (if a data structure was detected) */
  viz?: VizPayload | null;
};

export type RunRequest = {
  language: "python";
  code: string;
  tests: TestCase[];
  limits?: { timeoutMs?: number; memoryMB?: number };
};

export const RUNNER_CONTRACT_VERSION = "1.0.0";