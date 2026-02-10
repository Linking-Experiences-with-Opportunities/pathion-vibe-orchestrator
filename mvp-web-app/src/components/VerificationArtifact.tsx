"use client";

import React, { useState } from "react";
import {
  BrainCircuit,
  AlertTriangle,
  Zap,
  Play,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react";
import { useShadowRunner } from "@/hooks/useShadowRunner";
import type { ReportCard, CognitiveShadowFrame } from "@/lib/verificationAgent";
import { CognitiveShadow } from "./CognitiveShadow";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VerificationArtifactProps {
  reportCard: ReportCard;
  cognitiveShadow: CognitiveShadowFrame[];
  onDismiss: () => void;
  /** Called when the verification challenge passes (user's model was correct/matched reality) */
  onMatch?: () => void;
  /** Called when the verification challenge fails (user's model had a gap/mismatch) */
  onMismatch?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the Verification Agent's "Cognitive Mirror" Report Card.
 *
 * Contains:
 * 1. Diagnosis — root cause of the structural failure
 * 2. Mental Model Gap — the flawed assumption
 * 3. Verification Challenge — a runnable Python assertion + "Run Challenge" button
 * 4. Cognitive Shadow — streaming assumption vs. reality frames
 */
export const VerificationArtifact: React.FC<VerificationArtifactProps> = ({
  reportCard,
  cognitiveShadow,
  onDismiss,
  onMatch,
  onMismatch,
}) => {
  const [challengeResult, setChallengeResult] = useState<
    "idle" | "running" | "assertion_failed" | "passed" | "error"
  >("idle");
  const [challengeOutput, setChallengeOutput] = useState<string>("");

  const { run: runPyodide } = useShadowRunner({ timeoutMs: 3000 });

  /**
   * Execute the verification challenge assertion in Pyodide.
   * Expected result: AssertionError (proves the user's assumption is wrong).
   */
  async function handleRunChallenge() {
    setChallengeResult("running");
    setChallengeOutput("");

    try {
      const result = await runPyodide(reportCard.verificationChallenge, []);

      if (result.success) {
        // The assertion passed — unexpected (user's code is actually correct for this case)
        setChallengeResult("passed");
        setChallengeOutput(
          "The assertion passed. Your logic may be correct for this case."
        );
        onMatch?.();
      } else {
        const errorStr = result.error ?? "";
        if (errorStr.includes("AssertionError")) {
          // Expected: the assertion failed, proving the mental model gap
          setChallengeResult("assertion_failed");
          setChallengeOutput(errorStr);
          onMismatch?.();
        } else {
          // Some other error
          setChallengeResult("error");
          setChallengeOutput(errorStr);
        }
      }
    } catch (err) {
      setChallengeResult("error");
      setChallengeOutput(
        err instanceof Error ? err.message : "Challenge execution failed"
      );
    }
  }

  return (
    <div className="flex flex-col gap-4 bg-[#0d1520] text-slate-200 p-5 rounded-lg border border-slate-800 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
            <BrainCircuit size={18} className="text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              Verification Artifact
            </h3>
            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">
              Cognitive Mirror
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-600 hover:text-slate-400 transition-colors p-1"
          aria-label="Dismiss verification artifact"
        >
          <X size={16} />
        </button>
      </div>

      {/* 1. Diagnosis */}
      <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">
            Diagnosis
          </span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          {reportCard.diagnosis}
        </p>
      </div>

      {/* 2. Mental Model Gap */}
      <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <BrainCircuit size={14} className="text-blue-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
            Mental Model Gap
          </span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed italic">
          &quot;{reportCard.mentalModelGap}&quot;
        </p>
      </div>

      {/* 3. Verification Challenge */}
      <div className="bg-slate-900 border border-slate-700 p-4 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-yellow-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500">
              Verification Challenge
            </span>
          </div>
          <button
            onClick={handleRunChallenge}
            disabled={challengeResult === "running"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${challengeResult === "running"
                ? "bg-yellow-500/20 text-yellow-500/50 cursor-wait"
                : "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border border-yellow-500/30"
              }`}
          >
            <Play size={12} fill="currentColor" />
            {challengeResult === "running" ? "Running..." : "Run Challenge"}
          </button>
        </div>

        {/* Code block */}
        <pre className="bg-black/50 rounded-lg p-3 overflow-x-auto">
          <code className="text-xs font-mono text-emerald-400 leading-relaxed whitespace-pre-wrap">
            {reportCard.verificationChallenge}
          </code>
        </pre>

        {/* Result */}
        {challengeResult !== "idle" && challengeResult !== "running" && (
          <div
            className={`mt-3 p-3 rounded-lg text-xs font-mono ${challengeResult === "assertion_failed"
                ? "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                : challengeResult === "passed"
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
              }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {challengeResult === "assertion_failed" ? (
                <>
                  <XCircle size={12} />
                  <span className="font-bold uppercase text-[10px] tracking-wider">
                    Assertion Failed — Mental Model Gap Confirmed
                  </span>
                </>
              ) : challengeResult === "passed" ? (
                <>
                  <CheckCircle2 size={12} />
                  <span className="font-bold uppercase text-[10px] tracking-wider">
                    Assertion Passed
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle size={12} />
                  <span className="font-bold uppercase text-[10px] tracking-wider">
                    Execution Error
                  </span>
                </>
              )}
            </div>
            <p className="whitespace-pre-wrap break-all">{challengeOutput}</p>
          </div>
        )}
      </div>

      {/* 4. Cognitive Shadow */}
      {cognitiveShadow.length > 0 && (
        <CognitiveShadow frames={cognitiveShadow} />
      )}
    </div>
  );
};
