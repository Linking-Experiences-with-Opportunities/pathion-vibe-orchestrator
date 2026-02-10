"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useShadowRunner } from "./useShadowRunner";

/**
 * Canonical syntax error from CPython's ast.parse
 */
export interface CanonicalSyntaxError {
  errorCode: 'COMPILATION_ERROR';
  message: string;           // CPython's error message
  line: number;              // 1-based
  column: number;            // 0-based
  errorType: string;         // e.g., "SyntaxError", "IndentationError"
  tooltip: string;           // User-friendly description
}

interface UseCanonicalSyntaxCheckOptions {
  /** Code to validate */
  code: string;
  /** Whether validation is enabled */
  enabled: boolean;
  /** Debounce delay in ms (default: 400ms) */
  debounceMs?: number;
}

interface UseCanonicalSyntaxCheckResult {
  /** Whether syntax is valid according to CPython */
  isValid: boolean;
  /** Syntax error if validation failed */
  error: CanonicalSyntaxError | null;
  /** Whether validation is currently in progress */
  isValidating: boolean;
}

/**
 * Canonical Python syntax validation using CPython's ast.parse via Pyodide
 *
 * This is the authoritative source of truth for syntax validation.
 * Used for execution gating and error display in SyntaxHealthPanel.
 *
 * @example
 * ```tsx
 * const { isValid, error } = useCanonicalSyntaxCheck({
 *   code: userCode,
 *   enabled: true,
 * });
 *
 * if (!isValid) {
 *   console.log('Syntax error:', error.message);
 * }
 * ```
 */
export function useCanonicalSyntaxCheck(
  options: UseCanonicalSyntaxCheckOptions
): UseCanonicalSyntaxCheckResult {
  const { code, enabled, debounceMs = 400 } = options;

  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<CanonicalSyntaxError | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidatedCodeRef = useRef<string>('');

  // Use Shadow Runner for lightweight Pyodide execution
  const { run: runPyodide, isReady: pyodideReady } = useShadowRunner();

  /**
   * Validate syntax using CPython's ast.parse
   */
  const validateSyntax = useCallback(async (codeToValidate: string) => {
    // Skip if code hasn't changed
    if (codeToValidate === lastValidatedCodeRef.current) {
      return;
    }

    // Skip if Pyodide not ready
    if (!pyodideReady) {
      console.log('[useCanonicalSyntaxCheck] Pyodide not ready, skipping validation');
      return;
    }

    // Handle empty code
    if (!codeToValidate || codeToValidate.trim().length === 0) {
      setIsValid(true);
      setError(null);
      lastValidatedCodeRef.current = codeToValidate;
      return;
    }

    setIsValidating(true);
    lastValidatedCodeRef.current = codeToValidate;

    try {
      // Encode code as base64 to avoid quoting/escaping and leading-whitespace issues
      const base64Code = typeof btoa !== 'undefined'
        ? btoa(unescape(encodeURIComponent(codeToValidate)))
        : Buffer.from(codeToValidate, 'utf-8').toString('base64');

      // Run ast.parse in Pyodide. Script has no leading indent to avoid IndentationError.
      const validationScript = `
import ast
import base64

try:
    encoded = "${base64Code}"
    code_to_parse = base64.b64decode(encoded).decode('utf-8')
    ast.parse(code_to_parse)
    result = {"valid": True}
except SyntaxError as e:
    result = {
        "valid": False,
        "message": str(e.msg) if getattr(e, 'msg', None) else "Syntax error",
        "line": int(e.lineno) if e.lineno is not None else 1,
        "column": int(e.offset) - 1 if e.offset is not None else 0,
        "error_type": type(e).__name__
    }
except Exception as e:
    result = {
        "valid": False,
        "message": str(e),
        "line": 1,
        "column": 0,
        "error_type": type(e).__name__
    }

result
`;

      const result = await runPyodide(validationScript, []);

      // Type guard for validation result
      const isValidationResult = (obj: unknown): obj is { valid: boolean; message?: string; line?: number; column?: number; error_type?: string } => {
        return typeof obj === 'object' && obj !== null && 'valid' in obj;
      };

      if (result.success && isValidationResult(result.output) && result.output.valid) {
        setIsValid(true);
        setError(null);
      } else if (result.success && isValidationResult(result.output) && !result.output.valid) {
        setIsValid(false);
        setError({
          errorCode: 'COMPILATION_ERROR',
          message: result.output.message || 'Syntax error',
          line: result.output.line || 1,
          column: result.output.column || 0,
          errorType: result.output.error_type || 'SyntaxError',
          tooltip: 'Your code has a syntax error. Python cannot parse this code. Fix the syntax before running tests.',
        });
      } else {
        // Pyodide execution failed
        console.error('[useCanonicalSyntaxCheck] Validation execution failed:', result);
        setIsValid(true); // Fail open - allow execution if validation fails
        setError(null);
      }
    } catch (err) {
      console.error('[useCanonicalSyntaxCheck] Validation error:', err);
      // Fail open - allow execution if validation crashes
      setIsValid(true);
      setError(null);
    } finally {
      setIsValidating(false);
    }
  }, [runPyodide, pyodideReady]);

  /**
   * Debounced validation effect
   */
  useEffect(() => {
    // Skip if not enabled
    if (!enabled) {
      // Clear errors when disabled
      if (error) {
        setIsValid(true);
        setError(null);
      }
      return;
    }

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounced timer
    debounceTimerRef.current = setTimeout(() => {
      validateSyntax(code);
    }, debounceMs);

    // Cleanup timer
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [code, enabled, debounceMs, validateSyntax, error]);

  return {
    isValid,
    error,
    isValidating,
  };
}
