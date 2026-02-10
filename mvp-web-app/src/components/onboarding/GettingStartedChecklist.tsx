"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { X, ChevronUp, Check, Layout, Play, Send, ArrowRight, Rocket } from "lucide-react";
import { useOnboardingChecklist, ChecklistStep } from "@/hooks/useOnboardingChecklist";
import { initProfileNanoFromUserGesture } from "@/lib/profileNanoEditor";

// ============================================================================
// Progress Bar Component
// ============================================================================
interface ProgressBarProps {
  totalSteps: number;
  currentStepIndex: number;
}

function ProgressBar({ totalSteps, currentStepIndex }: ProgressBarProps) {
  return (
    <div
      className="flex gap-1.5 w-full mb-6"
      aria-label={`Progress: ${currentStepIndex} of ${totalSteps} steps completed`}
    >
      {Array.from({ length: totalSteps }).map((_, index) => {
        const isCompleted = index < currentStepIndex;
        const isCurrent = index === currentStepIndex;

        return (
          <div
            key={index}
            className="h-1.5 rounded-full flex-1 overflow-hidden bg-gray-700 relative"
          >
            <div
              className={`absolute inset-0 transition-all duration-500 ease-out ${isCompleted
                ? "bg-emerald-500 w-full"
                : isCurrent
                  ? "bg-gradient-to-r from-blue-500 to-cyan-400 w-1/2"
                  : "bg-transparent"
                }`}
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step Item Component
// ============================================================================
interface StepItemProps {
  step: ChecklistStep;
  onAction: (step: ChecklistStep) => void;
  isLoading?: boolean;
}

function getStepIcon(id: number) {
  switch (id) {
    case 1:
      return <Layout size={16} className="ml-2" />;
    case 2:
      return <Play size={16} className="ml-2" />;
    case 3:
      return <Send size={16} className="ml-2" />;
    default:
      return <ArrowRight size={16} className="ml-2" />;
  }
}

function StepItem({ step, onAction, isLoading }: StepItemProps) {
  const isCompleted = step.status === "completed";
  const isCurrent = step.status === "current";

  return (
    <div
      className={`relative group transition-colors duration-300 ${isCurrent ? "py-4" : "py-3 opacity-80 hover:opacity-100"
        }`}
    >
      {/* Connector Line (don't show on last step) */}
      {step.id !== 4 && (
        <div
          className={`absolute left-[11px] top-8 bottom-[-12px] w-[2px] ${isCompleted ? "bg-blue-500/30" : "bg-gray-700/50"
            } -z-10`}
        />
      )}

      <div className="flex items-start gap-4">
        {/* Status Indicator */}
        <div className="flex-shrink-0 mt-0.5">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${isCompleted
              ? "bg-emerald-500 border-emerald-500 text-white scale-100"
              : isCurrent
                ? "bg-gray-800 border-blue-500 text-blue-500 ring-4 ring-blue-500/10"
                : "bg-transparent border-gray-600"
              }`}
          >
            {isCompleted ? (
              <Check size={14} strokeWidth={3} />
            ) : isCurrent ? (
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            ) : (
              <div />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3
            className={`text-sm font-medium transition-colors ${isCompleted
              ? "text-gray-500 line-through decoration-gray-600"
              : isCurrent
                ? "text-white text-base"
                : "text-gray-400"
              }`}
          >
            {step.title}
          </h3>

          {/* Expanded content for current step */}
          <div
            className={`overflow-hidden transition-all duration-300 ${isCurrent ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
              }`}
          >
            <div className="pt-2 pb-1">
              {step.helperText && (
                <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                  {step.helperText}
                </p>
              )}

              <button
                onClick={() => onAction(step)}
                disabled={isLoading}
                className="
                  inline-flex items-center px-4 py-2 
                  bg-gradient-to-r from-blue-500 to-cyan-500
                  hover:opacity-90 active:opacity-100
                  text-white text-sm font-semibold rounded-lg 
                  shadow-md hover:shadow-lg hover:shadow-blue-500/20 
                  transition-all duration-200
                  disabled:opacity-70 disabled:cursor-not-allowed
                "
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    {step.ctaLabel}
                    {getStepIcon(step.id)}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Demo Project Success Screen (Project Zero completed - NOT true activation)
// ============================================================================
interface DemoProjectSuccessScreenProps {
  onContinue: () => void;
  secondProjectRoute: string | null;
}

function DemoProjectSuccessScreen({ onContinue, secondProjectRoute }: DemoProjectSuccessScreenProps) {
  const router = useRouter();

  return (
    <div className="text-center py-6 px-4 flex flex-col items-center justify-center animate-fade-in">
      <div className="w-14 h-14 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 text-blue-400 border border-blue-500/20">
        <Rocket size={28} />
      </div>

      <h2 className="text-lg font-bold text-white mb-2">Nice work! 🚀</h2>
      <p className="text-gray-400 text-sm mb-5 max-w-[220px]">
        You&apos;ve completed the warm-up. Now you&apos;re ready for your first real project!
      </p>

      <button
        onClick={() => {
          initProfileNanoFromUserGesture();
          if (secondProjectRoute) {
            router.push(secondProjectRoute);
          } else {
            router.push("/projects");
          }
          onContinue();
        }}
        className="
          w-full max-w-[200px] flex items-center justify-center gap-2
          bg-gradient-to-r from-blue-500 to-cyan-500
          hover:opacity-90
          text-white
          font-semibold py-2.5 px-4 rounded-xl
          transition-all duration-200 shadow-lg
        "
      >
        Start Project 1 <ArrowRight size={16} />
      </button>

      <button
        onClick={onContinue}
        className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        I&apos;ll do it later
      </button>
    </div>
  );
}

// ============================================================================
// Main Widget Component
// ============================================================================
export function GettingStartedChecklist() {
  const onboarding = useOnboardingChecklist();
  const router = useRouter();

  // Don't render if not authenticated or already completed Project Zero
  if (!onboarding) {
    return null;
  }

  const {
    steps,
    completedCount,
    totalSteps,
    showDemoProjectSuccess,
    isCollapsed,
    toggleCollapsed,
    collapse,
    secondProjectId,
  } = onboarding;

  const progressPercentage = Math.round((completedCount / totalSteps) * 100);

  const handleStepAction = (step: ChecklistStep) => {
    if (step.route) {
      initProfileNanoFromUserGesture();
      router.push(step.route);
      collapse();
    }
  };

  // Determine what to show in the body
  const renderBody = () => {
    // Demo project success (submitted Project Zero)
    if (showDemoProjectSuccess) {
      return (
        <DemoProjectSuccessScreen
          onContinue={collapse}
          secondProjectRoute={secondProjectId ? `/projects/${secondProjectId}` : null}
        />
      );
    }

    // Normal checklist view
    return (
      <div className="space-y-1">
        {steps.map((step) => (
          <StepItem
            key={step.id}
            step={step}
            onAction={handleStepAction}
          />
        ))}
      </div>
    );
  };

  // Determine pill label
  const getPillLabel = () => {
    if (showDemoProjectSuccess) {
      return "Ready for more!";
    }
    return "Getting Started";
  };

  const showSuccessState = showDemoProjectSuccess;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end sm:bottom-6 sm:right-6 font-sans">
      {/* EXPANDED PANEL */}
      <div
        className={`
          mb-4 w-[calc(100vw-32px)] sm:w-[320px] 
          bg-gray-900/95 backdrop-blur-sm
          rounded-2xl shadow-2xl ring-1 ring-gray-700
          overflow-hidden flex flex-col origin-bottom-right
          transition-all duration-300 ease-out
          ${isCollapsed ? "opacity-0 scale-95 pointer-events-none h-0" : "opacity-100 scale-100"}
        `}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 pb-2">
          <div className="flex justify-between items-start mb-1">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">Getting Started</h2>
              {!showSuccessState && (
                <p className="text-[10px] sm:text-xs text-gray-400 mt-1">
                  Complete these steps to get started.
                </p>
              )}
            </div>
            <button
              onClick={collapse}
              className="p-1 rounded-full hover:bg-gray-800 text-gray-500 transition-colors"
              aria-label="Close checklist"
            >
              <X size={20} />
            </button>
          </div>

          {!showSuccessState && (
            <ProgressBar totalSteps={totalSteps} currentStepIndex={completedCount} />
          )}
        </div>

        {/* Body */}
        <div className="px-4 pb-4 sm:px-6 sm:pb-6 overflow-y-auto max-h-[45vh] sm:max-h-[60vh]">
          {renderBody()}
        </div>
      </div>

      {/* COLLAPSED TRIGGER (Pill) */}
      <button
        onClick={toggleCollapsed}
        className={`
          flex items-center gap-3 pl-4 pr-3 py-3
          bg-gray-900/95 backdrop-blur-sm
          text-white
          rounded-full shadow-lg hover:shadow-xl
          border border-gray-700
          transition-all duration-300
          hover:scale-[1.02] active:scale-[0.98]
          ${isCollapsed ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none absolute"}
        `}
      >
        {showSuccessState ? (
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white bg-blue-500">
            <Rocket size={12} />
          </div>
        ) : (
          // Circular progress indicator (mini)
          <div className="relative w-5 h-5">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 24 24">
              <circle
                className="text-gray-700"
                strokeWidth="4"
                stroke="currentColor"
                fill="transparent"
                r="10"
                cx="12"
                cy="12"
              />
              <circle
                className="text-blue-500"
                strokeWidth="4"
                strokeDasharray={2 * Math.PI * 10}
                strokeDashoffset={2 * Math.PI * 10 * (1 - progressPercentage / 100)}
                strokeLinecap="round"
                stroke="currentColor"
                fill="transparent"
                r="10"
                cx="12"
                cy="12"
              />
            </svg>
          </div>
        )}

        <div className="flex flex-col items-start mr-2">
          <span className="font-semibold text-sm leading-none">
            {getPillLabel()}
          </span>
          {!showSuccessState && (
            <span className="text-[10px] text-gray-400 font-medium mt-0.5">
              {completedCount}/{totalSteps} completed
            </span>
          )}
        </div>

        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-400">
          <ChevronUp size={16} />
        </div>
      </button>
    </div>
  );
}

export default GettingStartedChecklist;
