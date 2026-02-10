"use client";

import { useEffect, useRef } from "react";
import { useCanonicalSyntaxCheck, CanonicalSyntaxError } from "./useCanonicalSyntaxCheck";

interface UseContinuousRunnerOptions {
  /** Code to continuously validate */
  code: string;
  /** Whether continuous mode is enabled */
  enabled: boolean;
  /** Debounce delay in ms (default: 400ms) */
  debounceMs?: number;
  /** Callback when syntax is valid - trigger execution */
  onValidCode?: (code: string) => void;
  /** Callback when syntax error detected */
  onSyntaxError?: (error: CanonicalSyntaxError) => void;
}

interface UseContinuousRunnerResult {
  /** Current syntax error (null if valid) */
  syntaxError: CanonicalSyntaxError | null;
  /** Whether syntax is currently valid */
  isValid: boolean;
  /** Whether validation is in progress */
  isValidating: boolean;
}

/**
 * React hook for continuous code validation with execution gating
 *
 * Uses canonical CPython validation (ast.parse via Pyodide) as the source of truth.
 * Only triggers execution when code passes canonical validation.
 *
 * Tree-sitter markers are handled separately in CodeEditor for fast feedback.
 *
 * @example
 * ```tsx
 * const { syntaxError, isValid } = useContinuousRunner({
 *   code: userCode,
 *   enabled: true,
 *   onValidCode: (code) => runShadowRunner(code),
 *   onSyntaxError: (error) => console.log('Syntax error:', error),
 * });
 * ```
 */
export function useContinuousRunner(options: UseContinuousRunnerOptions): UseContinuousRunnerResult {
  const {
    code,
    enabled,
    debounceMs = 400,
    onValidCode,
    onSyntaxError,
  } = options;

  // Previous code ref to detect changes for callbacks
  const prevCodeRef = useRef<string>('');
  const prevIsValidRef = useRef<boolean>(true);

  // Use canonical validation as execution gate
  const { isValid, error, isValidating } = useCanonicalSyntaxCheck({
    code,
    enabled,
    debounceMs,
  });

  /**
   * Trigger callbacks when validation state changes
   */
  useEffect(() => {
    // Skip if code hasn't changed
    if (code === prevCodeRef.current && isValid === prevIsValidRef.current) {
      return;
    }

    // Skip if currently validating (wait for final result)
    if (isValidating) {
      return;
    }

    // Update refs
    prevCodeRef.current = code;
    prevIsValidRef.current = isValid;

    // Trigger appropriate callback
    if (isValid && enabled) {
      // Canonical validation passed - safe to execute
      onValidCode?.(code);
    } else if (error && enabled) {
      // Canonical validation failed - report error
      onSyntaxError?.(error);
    }
  }, [code, isValid, error, isValidating, enabled, onValidCode, onSyntaxError]);

  return {
    syntaxError: error,
    isValid,
    isValidating,
  };
}
