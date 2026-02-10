"use client";

import React from 'react';
import { 
  CheckCircle2, 
  Lock, 
  Play, 
  FileText, 
  Code2,
  ChevronRight 
} from 'lucide-react';
import { Lesson } from './types';

interface SidebarProps {
  lessons: Lesson[];
  currentLessonId: string;
  onSelectLesson: (lesson: Lesson) => void;
  moduleTitle?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  lessons,
  currentLessonId,
  onSelectLesson,
  moduleTitle,
}) => {
  const completedCount = lessons.filter(l => l.isCompleted).length;
  const progress = lessons.length > 0 ? (completedCount / lessons.length) * 100 : 0;

  const getLessonIcon = (lesson: Lesson, isActive: boolean) => {
    if (lesson.isLocked) {
      return <Lock size={16} className="text-slate-600" />;
    }
    if (lesson.isCompleted) {
      return <CheckCircle2 size={16} className="text-green-500" />;
    }
    
    const iconClass = isActive ? "text-cyan-400" : "text-slate-500";
    
    switch (lesson.kind) {
      case 'video':
        return <Play size={16} className={iconClass} />;
      case 'text':
        return <FileText size={16} className={iconClass} />;
      case 'question':
        return <Code2 size={16} className={iconClass} />;
      default:
        return <FileText size={16} className={iconClass} />;
    }
  };

  const getLessonTypeLabel = (kind: Lesson['kind']) => {
    switch (kind) {
      case 'video':
        return 'VIDEO';
      case 'text':
        return 'READING';
      case 'question':
        return 'QUESTION';
      default:
        return 'LESSON';
    }
  };

  return (
    <aside className="w-80 lg:w-96 bg-slate-900/50 backdrop-blur-md border-l border-white/5 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <h2 className="font-bold text-white text-lg mb-1">
          {moduleTitle || 'Course Content'}
        </h2>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>{completedCount} of {lessons.length} completed</span>
          <span className="text-slate-700">•</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        {/* Progress Bar */}
        <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Lesson List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
        {lessons.map((lesson, index) => {
          const isActive = lesson.id === currentLessonId;
          const isLocked = lesson.isLocked;

          return (
            <button
              key={lesson.id}
              onClick={() => !isLocked && onSelectLesson(lesson)}
              disabled={isLocked}
              className={`
                w-full text-left p-3 rounded-xl transition-all duration-200 group relative
                ${isActive
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 shadow-lg shadow-cyan-500/10'
                  : isLocked
                    ? 'bg-slate-800/30 cursor-not-allowed opacity-50'
                    : 'bg-slate-800/50 hover:bg-slate-800 border border-transparent hover:border-white/5'
                }
              `}
            >
              {/* Active Indicator */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-cyan-500 rounded-r-full" />
              )}

              <div className="flex items-start gap-3">
                {/* Lesson Number & Icon */}
                <div className={`
                  flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center
                  ${isActive
                    ? 'bg-cyan-500/20'
                    : lesson.isCompleted
                      ? 'bg-green-500/20'
                      : 'bg-slate-700/50'
                  }
                `}>
                  {getLessonIcon(lesson, isActive)}
                </div>

                {/* Lesson Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`
                      text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded
                      ${isActive
                        ? 'bg-cyan-500/20 text-cyan-400'
                        : 'bg-slate-700 text-slate-500'
                      }
                    `}>
                      {getLessonTypeLabel(lesson.kind)}
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className={`
                    text-sm font-medium truncate
                    ${isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'}
                  `}>
                    {lesson.title}
                  </h3>
                  {lesson.duration && (
                    <p className="text-xs text-slate-500 mt-1">
                      {Math.floor(lesson.duration / 60)}:{String(lesson.duration % 60).padStart(2, '0')} min
                    </p>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight
                  size={16}
                  className={`
                    flex-shrink-0 transition-transform
                    ${isActive
                      ? 'text-cyan-400 translate-x-1'
                      : 'text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1'
                    }
                  `}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/5 bg-slate-900/50">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Need help?</span>
          <button className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium">
            Contact Support
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
