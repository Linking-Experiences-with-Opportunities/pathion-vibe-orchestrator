/**
 * Universal Error Code Mapping for Test Runners
 * 
 * This module provides standardized error codes and tooltips for test execution failures
 * across all languages (starting with Python). This allows the frontend to display
 * consistent badges and user-friendly messages regardless of the language.
 * 
 * Related: ENG-502
 */

/**
 * Universal Error Codes for test execution failures
 */
export type UniversalErrorCode =
  | "COMPILATION_ERROR"
  | "RUNTIME_ERROR"
  | "TEST_FAILED"
  | "MISSING_EXPECTED_ERROR"
  | "TIMEOUT"
  | "MEMORY_LIMIT"
  | null; // null = test passed

/**
 * Error code metadata with user-friendly descriptions
 */
export interface ErrorCodeInfo {
  code: UniversalErrorCode;
  tooltip: string;
}

/**
 * Mapping of error codes to user-friendly tooltips
 */
const ERROR_TOOLTIPS: Record<Exclude<UniversalErrorCode, null>, string> = {
  COMPILATION_ERROR: "The code failed to build or interpret before running. Check for syntax errors, indentation issues, or missing semicolons.",
  RUNTIME_ERROR: "The code stopped running because it hit a fatal error. Check your variables and logic flow.",
  TEST_FAILED: "The code ran successfully but returned the wrong result. Compare expected vs actual output.",
  MISSING_EXPECTED_ERROR: "The test expected your code to throw an error (e.g., for input validation), but it didn't.",
  TIMEOUT: "The code ran longer than the allowed execution limit. Check for infinite loops.",
  MEMORY_LIMIT: "The code exceeded the RAM allocation limit. Check for memory leaks or large data structures."
};

/**
 * Map a Python error message and test status to a universal error code
 * 
 * @param status - Test status from runner: 'pass', 'fail', 'error'
 * @param message - Error message or failure details
 * @param stderr - Standard error output (for compilation errors)
 * @param executionTime - Execution time in milliseconds
 * @param timeoutLimit - Timeout limit in milliseconds
 * @returns ErrorCodeInfo with code and tooltip
 */
export function mapPythonError(
  status: 'pass' | 'fail' | 'error',
  message?: string,
  stderr?: string,
  executionTime?: number,
  timeoutLimit?: number
): ErrorCodeInfo {
  // Test passed - no error
  if (status === 'pass') {
    return { code: null, tooltip: "" };
  }

  const msg = message || "";
  const err = stderr || "";

  // Check for timeout
  if (
    (executionTime && timeoutLimit && executionTime >= timeoutLimit) ||
    msg.includes("Execution timed out") ||
    err.includes("Execution timed out")
  ) {
    return {
      code: "TIMEOUT",
      tooltip: ERROR_TOOLTIPS.TIMEOUT
    };
  }

  // Check for compilation/syntax errors (checked before execution)
  if (err.includes("SyntaxError") || err.includes("IndentationError")) {
    return {
      code: "COMPILATION_ERROR",
      tooltip: ERROR_TOOLTIPS.COMPILATION_ERROR
    };
  }

  // Test failed (assertion error)
  if (status === 'fail') {
    // Check if this is a "missing expected error" scenario
    // Pattern: "IndexError not raised", "ValueError not raised", etc.
    if (/\w+Error not raised/i.test(msg)) {
      return {
        code: "MISSING_EXPECTED_ERROR",
        tooltip: ERROR_TOOLTIPS.MISSING_EXPECTED_ERROR
      };
    }

    // Check for assertion failure patterns
    if (
      msg.includes("!=") ||
      msg.includes("False is not True") ||
      msg.includes("is not equal to") ||
      msg.includes("Expected") ||
      msg.includes("Assertion failed") ||
      msg.includes("AssertionError")
    ) {
      return {
        code: "TEST_FAILED",
        tooltip: ERROR_TOOLTIPS.TEST_FAILED
      };
    }

    // Generic test failure (no specific pattern matched)
    return {
      code: "TEST_FAILED",
      tooltip: ERROR_TOOLTIPS.TEST_FAILED
    };
  }

  // Test error (exception during execution)
  if (status === 'error') {
    // Runtime errors include: NameError, TypeError, IndexError, KeyError, 
    // AttributeError, ValueError, ZeroDivisionError, etc.
    return {
      code: "RUNTIME_ERROR",
      tooltip: ERROR_TOOLTIPS.RUNTIME_ERROR
    };
  }

  // Fallback (should not reach here)
  return {
    code: "RUNTIME_ERROR",
    tooltip: ERROR_TOOLTIPS.RUNTIME_ERROR
  };
}

/**
 * Get user-friendly tooltip for an error code
 */
export function getErrorTooltip(errorCode: UniversalErrorCode): string {
  if (!errorCode) return "";
  return ERROR_TOOLTIPS[errorCode] || "";
}

