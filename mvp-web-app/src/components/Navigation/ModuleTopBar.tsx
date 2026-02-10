"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useModuleNavigation } from "@/contexts/module-navigation-context";

/**
 * Inline module navigation buttons for use within component headers.
 * Returns null if not in a module context.
 */
export function ModuleNavigationButtons() {
  const { navigationState, onPrev, onNext } = useModuleNavigation();

  // Don't render if not on a module page or no navigation state
  if (!navigationState) {
    return null;
  }

  const { currentIndex, totalCount } = navigationState;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrev ?? undefined}
        disabled={!hasPrev || !onPrev}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          !hasPrev || !onPrev
            ? 'border-zinc-800 text-zinc-600 cursor-not-allowed' 
            : 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-zinc-600'
        }`}
      >
        <ChevronLeft size={14} />
        Previous
      </button>
      <button
        onClick={onNext ?? undefined}
        disabled={!hasNext || !onNext}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          !hasNext || !onNext
            ? 'border-zinc-800 text-zinc-600 cursor-not-allowed' 
            : 'bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700 hover:border-zinc-600'
        }`}
      >
        Next
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

/**
 * Full top bar with module info and navigation.
 * Can be used standalone if needed.
 */
export default function ModuleTopBar() {
  const { navigationState } = useModuleNavigation();

  // Don't render if not on a module page or no navigation state
  if (!navigationState) {
    return null;
  }

  const { currentIndex, totalCount, moduleTitle, currentLessonTitle } = navigationState;

  return (
    <div className="sticky top-0 z-40 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left: Module info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs text-zinc-500 hidden sm:block">
            {moduleTitle}
          </div>
          <div className="hidden sm:block text-zinc-700">•</div>
          <div className="text-sm font-medium text-zinc-300 truncate">
            {currentLessonTitle}
          </div>
          <div className="text-xs text-zinc-600 whitespace-nowrap">
            ({currentIndex + 1}/{totalCount})
          </div>
        </div>

        {/* Right: Prev/Next Navigation */}
        <ModuleNavigationButtons />
      </div>
    </div>
  );
}
