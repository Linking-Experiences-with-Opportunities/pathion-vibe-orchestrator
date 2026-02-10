"use client";

import React from "react";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { CanonicalSyntaxError } from "@/hooks/useCanonicalSyntaxCheck";

interface SyntaxHealthPanelProps {
  /** Syntax error from canonical validation (null if valid) */
  syntaxError: CanonicalSyntaxError | null;
  /** Whether validation is currently running */
  isValidating: boolean;
}

/**
 * Dedicated panel for displaying Python syntax validation status
 *
 * Shows:
 * - Validating state (spinner)
 * - Valid state (collapsed, minimal)
 * - Error state (expanded, prominent with error details)
 *
 * Separate from test results to avoid confusion between syntax errors and test failures.
 */
export function SyntaxHealthPanel({ syntaxError, isValidating }: SyntaxHealthPanelProps) {
  // Validating state
  if (isValidating) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-blue-900/20 border-l-4 border-blue-500 text-blue-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Validating syntax...</span>
      </div>
    );
  }

  // Valid state (collapsed, minimal)
  if (!syntaxError) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-green-900/10 border-l-4 border-green-500 text-green-400">
        <CheckCircle className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Syntax valid</span>
      </div>
    );
  }

  // Error state (expanded, prominent)
  return (
    <div className="px-4 py-3 bg-orange-900/20 border-l-4 border-orange-500">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-orange-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-semibold text-orange-300">
              {syntaxError.errorType}
            </span>
            <span className="text-xs text-gray-400">
              Line {syntaxError.line}, Column {syntaxError.column + 1}
            </span>
          </div>
          <p className="text-sm text-gray-300 mb-2">
            {syntaxError.message}
          </p>
          <p className="text-xs text-gray-400 italic">
            {syntaxError.tooltip}
          </p>
        </div>
      </div>
    </div>
  );
}
