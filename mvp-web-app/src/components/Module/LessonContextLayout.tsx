'use client';

import React from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, ChevronLeft,  PlayCircle, BookOpen, Code2, Target, AlertCircle } from 'lucide-react';
import { ActivityType, Activity } from '@/types/curriculum';
import { initProfileNanoFromUserGesture } from '@/lib/profileNanoEditor';

interface LessonContentLayoutProps {
  title: string;
  moduleTitle: string;
  type: ActivityType;
  duration?: string;
  isCompleted?: boolean;
  onBack: () => void;
  onComplete: () => void;
  onNext: () => void;
  hasPrev: boolean;
  onPrev: () => void;
  nextActivity: Activity | null;
  /** Show "Complete Module" button when on last lesson and all others done */
  showCompleteModule?: boolean;
  children: React.ReactNode;
}

const LessonContentLayout: React.FC<LessonContentLayoutProps> = ({ 
  title, 
  moduleTitle, 
  type, 
  duration,
  isCompleted = false,
  onBack, 
  onComplete, 
  onNext, 
  hasPrev,
  onPrev,
  nextActivity,
  showCompleteModule = false,
  children 
}) => {
  /**
   * Explicit type checks — no fallthrough.
   * Each ActivityType is handled explicitly.
   */
  const isVideo = type === 'lecture';
  const isProject = type === 'project';
  const isQuestion = type === 'question';
  const isReading = type === 'reading';
  const isUnknown = type === 'unknown';
  const isCodingActivity = isProject || isQuestion;

  /**
   * Get icon for activity type.
   * IMPORTANT: Explicit per type — no default fallthrough.
   */
  const getTypeIcon = () => {
    switch (type) {
      case 'lecture': return <PlayCircle size={24} />;
      case 'project': return <Code2 size={24} />;
      case 'question': return <Target size={24} />;
      case 'reading': return <BookOpen size={24} />;
      case 'unknown': return <AlertCircle size={24} />;
    }
  };

  /**
   * Get label for activity type.
   * IMPORTANT: Explicit per type — no default fallthrough.
   */
  const getTypeLabel = () => {
    switch (type) {
      case 'lecture': return 'Video Lesson';
      case 'project': return 'Project';
      case 'question': return 'Practice Question';
      case 'reading': return 'Reading Material';
      case 'unknown': return 'Unknown Content';
    }
  };

  /**
   * Get icon color for activity type.
   * IMPORTANT: Explicit per type — no default fallthrough.
   */
  const getIconColor = () => {
    switch (type) {
      case 'project': return 'text-emerald-500';
      case 'question': return 'text-amber-500';
      case 'lecture': return 'text-purple-500';
      case 'reading': return 'text-blue-500';
      case 'unknown': return 'text-zinc-500';
    }
  };

  /**
   * Get badge style for activity type.
   * IMPORTANT: Explicit per type — no default fallthrough.
   */
  const getBadgeStyle = () => {
    switch (type) {
      case 'project': return 'text-emerald-500 bg-emerald-500/10';
      case 'question': return 'text-amber-500 bg-amber-500/10';
      case 'lecture': return 'text-purple-500 bg-purple-500/10';
      case 'reading': return 'text-blue-500 bg-blue-500/10';
      case 'unknown': return 'text-zinc-500 bg-zinc-500/10';
    }
  };

  /**
   * Get context-aware forward button label based on next activity type.
   * IMPORTANT: Explicit per type — no default fallthrough.
   */
  const getForwardButtonLabel = (): string => {
    // Show "Complete Module" when on last lesson and all others done
    if (showCompleteModule) {
      return 'Complete Module';
    }
    
    if (!nextActivity) {
      return 'Finish Module';
    }
    
    switch (nextActivity.type) {
      case 'lecture':
        return 'Continue to Lecture';
      case 'reading':
        return 'Next Page';
      case 'question':
        return 'Continue to Practice';
      case 'project':
        return 'Continue to Project';
      case 'unknown':
        return 'Continue';
    }
  };

  const hasNext = nextActivity !== null;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Top Breadcrumb & Navigation */}
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors group w-fit mb-4 flex-shrink-0"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
        <span className="text-sm font-medium">Back to {moduleTitle}</span>
      </button>

      {/* Main Content Shell - fills remaining height */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl flex-1 min-h-0">
        
        {/* Card Header - fixed height */}
        <div className="p-4 sm:p-6 border-b border-zinc-800 bg-zinc-900/30 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 ${getIconColor()}`}>
              {getTypeIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded ${getBadgeStyle()}`}>
                  {getTypeLabel()}
                </span>
                {isCompleted && (
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-green-500 bg-green-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 size={10} />
                    Completed
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h1>
            </div>
          </div>
          
          {duration && (
            <div className="hidden sm:flex items-center gap-2 text-zinc-500 text-xs font-medium">
              <span>~{duration}</span>
            </div>
          )}
        </div>

        {/* Content Area - scrollable, fills remaining space */}
        <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${isVideo ? 'bg-black' : isCodingActivity ? '' : 'p-6 sm:p-8'}`}>
          {children}
        </div>

        {/* Action Footer - fixed height */}
        <div className="p-4 sm:p-6 border-t border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
          
          {/* Left: Previous Button (Secondary) */}
          <div className="w-full sm:w-auto">
             <button 
                onClick={onPrev}
                disabled={!hasPrev}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border border-transparent font-semibold text-sm transition-all w-full sm:w-auto justify-center group
                  ${hasPrev 
                    ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' 
                    : 'text-zinc-800 cursor-not-allowed opacity-50'
                  }`}
             >
                <ChevronLeft size={16} className={`transition-transform ${hasPrev ? 'group-hover:-translate-x-1' : ''}`} />
                Previous
             </button>
          </div>
          
          {/* Right: Primary Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
             <button 
                onClick={onComplete}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white font-semibold text-sm transition-all w-full sm:w-auto"
             >
               <CheckCircle2 size={18} className="text-zinc-600" />
               Mark as Complete
             </button>
          
          <button 
            onClick={() => {
              if (nextActivity?.type === 'project') {
                initProfileNanoFromUserGesture();
              }
              onNext();
            }}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] ${
              hasNext 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20' 
                : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20'
            }`}
          >
            {getForwardButtonLabel()}
            <ChevronRight size={18} />
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LessonContentLayout;
