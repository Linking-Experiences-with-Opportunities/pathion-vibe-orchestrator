"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  AlertTriangle, 
  RotateCcw, 
  ArrowLeft, 
  ChevronDown, 
  ChevronRight, 
  Terminal, 
  Cpu
} from 'lucide-react';

interface ErrorScreenProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Detect fetch/network failures (e.g. RSC payload, offline, server down). */
function isNetworkError(message: string): boolean {
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request") ||
    lower.includes("load failed")
  );
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ error, reset }) => {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);
  const [mounted, setMounted] = useState(false);
  const safeError = error ?? { message: "Unknown error", digest: undefined };
  const safeReset = reset ?? (() => {});
  const isNetwork = isNetworkError(safeError.message);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleNavigateProjects = () => {
    router.push('/projects');
  };

  return (
    <div className="min-h-screen w-full bg-lilo-bg flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-lilo-primary/30">
      
      {/* Background Decor: Grid & Gradient */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute inset-0 bg-radial-gradient from-lilo-primary/10 via-transparent to-transparent"></div>
      </div>

      <main className={`relative z-10 w-full max-w-lg transition-all duration-700 ease-out ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        
        {/* Main Card */}
        <div className="bg-lilo-surface border border-lilo-border rounded-2xl shadow-2xl shadow-black/40 overflow-hidden backdrop-blur-sm">
          
          {/* Header Section */}
          <div className="p-8 pb-6 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-lilo-bg border border-lilo-border flex items-center justify-center mb-6 shadow-inner relative group">
                <div className="absolute inset-0 rounded-full bg-lilo-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <Cpu className="h-8 w-8 text-lilo-primary/80 group-hover:text-lilo-cyan transition-colors duration-300" />
                <div className="absolute -bottom-1 -right-1 bg-lilo-bg rounded-full p-1 border border-lilo-border">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
              {isNetwork ? "We couldn't reach the server" : "Something went wrong."}
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
              {isNetwork
                ? "Check your internet connection, try again, or go back to Projects. If you're offline, the app may show cached content when you're back online."
                : "We ran into an internal issue while loading this page. This has been logged automatically."}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="px-8 pb-8 flex flex-col gap-3 w-full">
            <button
              onClick={handleNavigateProjects}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-medium shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all duration-200 active:scale-[0.98]"
            >
              <ArrowLeft className="h-4 w-4" />
              Go back to Projects
            </button>
            
            <button
              onClick={safeReset}
              className="w-full h-11 flex items-center justify-center gap-2 rounded-xl border border-lilo-border bg-transparent hover:bg-white/[0.03] text-slate-300 hover:text-white font-medium transition-all duration-200"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
            </button>
          </div>

          {/* Technical Details (Collapsible) */}
          <div className="border-t border-lilo-border bg-[#0B0F18]/50">
            <button 
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-6 py-4 flex items-center justify-between text-xs font-mono text-slate-500 hover:text-slate-400 transition-colors group"
            >
              <span className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5" />
                Technical details
              </span>
              {showDetails ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>

            {showDetails && (
              <div className="px-6 pb-6 animate-fade-in">
                <div className="p-4 rounded-lg bg-[#020617] border border-lilo-border overflow-x-auto custom-scrollbar">
                  <pre className="text-[11px] leading-relaxed font-mono text-red-300/90 whitespace-pre-wrap break-all">
                    {safeError.message || "Unknown error occurred"}
                    {safeError.digest && (
                      <span className="block mt-2 text-slate-500">
                        Digest: {safeError.digest}
                      </span>
                    )}
                  </pre>
                </div>
                <p className="mt-3 text-[10px] text-slate-600">
                  Error ID: <span className="font-mono text-slate-500">{Math.random().toString(36).substr(2, 9).toUpperCase()}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Visual Cue for Bug Report */}
        <div className="absolute -right-4 top-1/2 translate-x-full hidden lg:block pointer-events-none">
            {/* Desktop Side Cue */}
            <div className="flex items-center gap-3 w-48 opacity-40 group-hover:opacity-100 transition-opacity">
               <svg width="60" height="20" className="stroke-slate-600" fill="none">
                 <path d="M 0 10 Q 30 10 60 10" strokeDasharray="4 4" />
               </svg>
               <span className="text-xs text-slate-600 font-medium whitespace-nowrap">Bug report?</span>
            </div>
        </div>
      </main>

      {/* Subtle Nudge Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 hidden md:block">
        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
                <linearGradient id="gradient-line" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity="0" />
                    <stop offset="50%" stopColor="#3B82F6" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path 
                d="M 50 65 Q 55 85 95 92" 
                fill="none" 
                stroke="url(#gradient-line)" 
                strokeWidth="1.5" 
                strokeDasharray="4 6"
                className="opacity-0 animate-[fadeIn_2s_ease-in-out_1s_forwards]"
            />
        </svg>
      </div>

      {/* Mobile-friendly bottom text nudge */}
      <div className="mt-8 text-center opacity-0 animate-[fadeIn_1s_ease-out_1.5s_forwards]">
        <p className="text-xs text-slate-600 flex items-center justify-center gap-2">
            If this keeps happening, report it below
            <span className="block w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse"></span>
        </p>
      </div>

    </div>
  );
};

export default ErrorScreen;
