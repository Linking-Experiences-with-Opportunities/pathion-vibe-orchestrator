/**
 * Error categorization helper for the Linguistic Compiler
 * Analyzes error messages and returns deterministic error categories
 */

export type ErrorCode =
  | "TIMEOUT"
  | "COMPILATION_ERROR"
  | "RUNTIME_ERROR"
  | "TEST_FAILED";

export interface CategorizedError {
  code: ErrorCode;
  rawMessage: string;
}

/** Backend/runner codes we treat as valid for primary resolution (includes UniversalErrorCode). "unknown" or missing => use heuristic. */
const VALID_BACKEND_CODES: readonly string[] = [
  "TIMEOUT",
  "COMPILATION_ERROR",
  "RUNTIME_ERROR",
  "TEST_FAILED",
  "MEMORY",
  "MEMORY_LIMIT",
  "MISSING_EXPECTED_ERROR",
];

function mapBackendCodeToErrorCode(backendCode: string): ErrorCode {
  const normalized = backendCode?.trim().toUpperCase();
  if (normalized === "TIMEOUT") return "TIMEOUT";
  if (normalized === "COMPILATION_ERROR") return "COMPILATION_ERROR";
  if (normalized === "RUNTIME_ERROR" || normalized === "MEMORY" || normalized === "MEMORY_LIMIT" || normalized === "MISSING_EXPECTED_ERROR") return "RUNTIME_ERROR";
  if (normalized === "TEST_FAILED") return "TEST_FAILED";
  return "RUNTIME_ERROR"; // safe default for any other backend code we accept
}

/**
 * Heuristic (client-side regex) categorization from result.printed.
 * Used when backend errorCode is missing or invalid.
 */
function getDeterministicErrorFromPrinted(printed: string): CategorizedError {
  const msg = printed || "";

  if (msg.includes("WORKER_TIMEOUT") || msg.includes("Time Limit Exceeded")) {
    return { code: "TIMEOUT", rawMessage: msg };
  }
  if (msg.includes("SyntaxError") || msg.includes("IndentationError")) {
    return { code: "COMPILATION_ERROR", rawMessage: msg };
  }
  if (msg.includes("Traceback") || msg.includes("Error:")) {
    return { code: "RUNTIME_ERROR", rawMessage: msg };
  }
  return { code: "TEST_FAILED", rawMessage: msg };
}

/**
 * Hybrid resolver: prefer backend error code when available and valid; otherwise use regex on printed.
 * Input: printed message and optional backend errorCode (e.g. from test result).
 * Primary: if errorCode exists and is not "unknown", map it to AI categories.
 * Fallback: existing regex logic on result.printed (SyntaxError, WORKER_TIMEOUT, etc.).
 */
export function getDeterministicError(
  printed: string,
  backendErrorCode?: string | null
): CategorizedError {
  const msg = printed || "";
  const code = backendErrorCode?.trim();

  if (code && code.toLowerCase() !== "unknown" && VALID_BACKEND_CODES.includes(code.toUpperCase())) {
    return {
      code: mapBackendCodeToErrorCode(code),
      rawMessage: msg,
    };
  }

  return getDeterministicErrorFromPrinted(msg);
}

/**
 * Human-readable labels for error codes
 */
export const ERROR_LABELS: Record<ErrorCode, string> = {
  TIMEOUT: "Timeout",
  COMPILATION_ERROR: "Syntax Error",
  RUNTIME_ERROR: "Runtime Error",
  TEST_FAILED: "Wrong Output",
};
