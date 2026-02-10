"use client";

import React, { useState, useEffect, useRef } from "react";
import { Eye } from "lucide-react";
import type { CognitiveShadowFrame } from "@/lib/verificationAgent";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CognitiveShadowProps {
  frames: CognitiveShadowFrame[];
}

// ---------------------------------------------------------------------------
// Typewriter Hook
// ---------------------------------------------------------------------------

/**
 * Incrementally reveals text character by character.
 */
function useTypewriter(text: string, speed: number = 20, startDelay: number = 0) {
  const [displayed, setDisplayed] = useState("");
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setIsDone(false);

    if (!text) {
      setIsDone(true);
      return;
    }

    let index = 0;
    let timer: ReturnType<typeof setTimeout>;

    const startTimer = setTimeout(() => {
      timer = setInterval(() => {
        if (index < text.length) {
          setDisplayed(text.slice(0, index + 1));
          index++;
        } else {
          clearInterval(timer);
          setIsDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(startTimer);
      clearInterval(timer);
    };
  }, [text, speed, startDelay]);

  return { displayed, isDone };
}

// ---------------------------------------------------------------------------
// Single Frame Component
// ---------------------------------------------------------------------------

const ShadowFrame: React.FC<{
  frame: CognitiveShadowFrame;
  index: number;
  isVisible: boolean;
}> = ({ frame, index, isVisible }) => {
  const assumptionTyped = useTypewriter(
    isVisible ? frame.userAssumption : "",
    15,
    0
  );
  const realityTyped = useTypewriter(
    isVisible ? frame.wasmReality : "",
    15,
    frame.userAssumption.length * 15 + 200
  );
  const deltaTyped = useTypewriter(
    isVisible ? frame.delta : "",
    15,
    (frame.userAssumption.length + frame.wasmReality.length) * 15 + 400
  );

  if (!isVisible) return null;

  return (
    <div className="space-y-2 animate-in fade-in duration-500">
      {/* Assumption */}
      <div className="flex gap-2">
        <span className="text-[10px] font-black text-rose-500 uppercase tracking-wider shrink-0 w-28 text-right pt-0.5">
          You assume:
        </span>
        <span className="text-xs text-slate-400 font-mono leading-relaxed">
          {assumptionTyped.displayed}
          {!assumptionTyped.isDone && (
            <span className="inline-block w-1.5 h-3.5 bg-rose-500 ml-0.5 animate-pulse" />
          )}
        </span>
      </div>

      {/* WASM Reality */}
      <div className="flex gap-2">
        <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider shrink-0 w-28 text-right pt-0.5">
          WASM shows:
        </span>
        <span className="text-xs text-slate-400 font-mono leading-relaxed">
          {realityTyped.displayed}
          {assumptionTyped.isDone && !realityTyped.isDone && (
            <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse" />
          )}
        </span>
      </div>

      {/* Delta */}
      <div className="flex gap-2">
        <span className="text-[10px] font-black text-amber-500 uppercase tracking-wider shrink-0 w-28 text-right pt-0.5">
          Delta:
        </span>
        <span className="text-xs text-slate-300 font-mono leading-relaxed font-bold">
          {deltaTyped.displayed}
          {realityTyped.isDone && !deltaTyped.isDone && (
            <span className="inline-block w-1.5 h-3.5 bg-amber-500 ml-0.5 animate-pulse" />
          )}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * CognitiveShadow — a terminal-like view that streams AI reasoning about
 * user assumptions vs. actual WASM execution state.
 *
 * Frames are revealed sequentially with a typewriter effect.
 */
export const CognitiveShadow: React.FC<CognitiveShadowProps> = ({ frames }) => {
  const [visibleCount, setVisibleCount] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reveal frames one at a time with a delay
  useEffect(() => {
    if (visibleCount >= frames.length) return;

    const timer = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + 1, frames.length));
    }, 3000); // 3s between frames

    return () => clearTimeout(timer);
  }, [visibleCount, frames.length]);

  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleCount]);

  if (frames.length === 0) return null;

  return (
    <div className="bg-black/40 border border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/50 bg-slate-900/30">
        <Eye size={12} className="text-purple-400" />
        <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
          Cognitive Shadow
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-[9px] text-slate-600 font-mono">LIVE</span>
        </div>
      </div>

      {/* Frames */}
      <div
        ref={containerRef}
        className="p-4 space-y-4 max-h-48 overflow-y-auto scrollbar-thin scrollbar-track scrollbar-thumb"
      >
        {frames.map((frame, i) => (
          <ShadowFrame
            key={i}
            frame={frame}
            index={i}
            isVisible={i < visibleCount}
          />
        ))}
      </div>
    </div>
  );
};
