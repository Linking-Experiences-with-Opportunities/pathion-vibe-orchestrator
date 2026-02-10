import { UniversalErrorCode } from "./errorCodeMapper";
import { FEATURE_MERMAID_DEBUGGER } from "./flags";

/**
 * Determines if a test is eligible for the Debug View visualization.
 *
 * Rules:
 * 1. Feature flag must be enabled.
 * 2. Error code must be one of: TIMEOUT, RUNTIME_ERROR, TEST_FAILED.
 *    (COMPILATION_ERROR is explicitly excluded as it's usually syntax/indentation).
 * 3. OR if the same test has failed >= 3 times (failureCount threshold).
 * 4. OR if a data structure was detected in the output (always-on viz).
 *
 * @param testName - Name of the test case
 * @param errorCode - Universal error code from the runner
 * @param failureCount - Number of consecutive failures for this test (optional, default 0)
 * @param structureDetected - Whether a data structure was detected in execution output (optional, default false)
 */
export function isEligibleForViz(
  testName: string,
  errorCode: UniversalErrorCode,
  failureCount: number = 0,
  structureDetected: boolean = false
): boolean {
  if (!FEATURE_MERMAID_DEBUGGER) {
    return false;
  }

  // Never visualize compilation errors (syntax, indentation, etc.)
  if (errorCode === "COMPILATION_ERROR") {
    return false;
  }

  // Eligible error codes
  const eligibleCodes: UniversalErrorCode[] = ["TIMEOUT", "RUNTIME_ERROR", "TEST_FAILED"];

  if (eligibleCodes.includes(errorCode)) {
    return true;
  }

  // Eligible if failed repeatedly (e.g. 3 times)
  if (failureCount >= 3) {
    return true;
  }

  // Always-on viz: show visualization even on passing tests when a structure is detected
  if (structureDetected) {
    return true;
  }

  return false;
}
