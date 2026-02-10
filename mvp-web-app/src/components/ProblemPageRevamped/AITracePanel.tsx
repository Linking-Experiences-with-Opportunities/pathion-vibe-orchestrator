"use client";

import React, { useEffect, useState } from "react";

export interface AITracePanelProps {
  /** Raw markdown or plain text trace from the API */
  trace: string;
  /** Called when the user dismisses the panel */
  onDismiss?: () => void;
  /** Whether the panel is visible (for slide-up animation) */
  isVisible: boolean;
}

/**
 * Ghost Trace panel: terminal/debugger-style output for AI "Mental Stack Trace".
 * Slides up from the bottom when trace data is available.
 */
export function AITracePanel({ trace, onDismiss, isVisible }: AITracePanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isVisible && trace) {
      const t = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(t);
    }
    setMounted(false);
  }, [isVisible, trace]);

  if (!trace) return null;

  return (
    <div
      className={`
        overflow-hidden transition-all duration-300 ease-out
        ${isVisible ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"}
      `}
      aria-hidden={!isVisible}
    >
      <div
        className={`
          mt-2 rounded-lg border border-amber-500/40 bg-[#0d1117] font-mono text-sm
          shadow-lg transition-transform duration-300 ease-out
          ${mounted && isVisible ? "translate-y-0" : "translate-y-4"}
        `}
      >
        <div className="flex items-center justify-between border-b border-[#21262d] px-3 py-2">
          <span className="font-semibold text-amber-400/90">
            Detected Logic Drift
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-2 py-1 text-gray-400 hover:bg-[#21262d] hover:text-gray-200"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
        <div className="max-h-[320px] overflow-auto px-3 py-3 text-gray-300 whitespace-pre-wrap">
          {trace}
        </div>
      </div>
    </div>
  );
}
