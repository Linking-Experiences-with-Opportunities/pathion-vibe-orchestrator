import React from 'react';
import { Activity } from '../types';
import { BookOpen, PlayCircle, Code2, Target, Check, Lock, AlertCircle } from 'lucide-react';

interface ActivityItemProps {
  activity: Activity;
  isLast: boolean;
  onClick: (id: string) => void;
}

const ActivityItem: React.FC<ActivityItemProps> = ({ activity, isLast, onClick }) => {
  const isCompleted = activity.status === 'completed';
  const isInProgress = activity.status === 'in_progress';
  const isLocked = activity.status === 'locked';
  
  const IconMap = {
    reading: BookOpen,
    lecture: PlayCircle,
    project: Code2,
    problem: Target,
    question: Target,
    unknown: AlertCircle,
  };

  const Icon = IconMap[activity.type];

  // Node container styling - all states use 32px circles
  const getNodeStyle = () => {
    if (isCompleted) return "bg-green-500 border-green-500 text-black";
    if (isInProgress) return "bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]";
    // Locked & Not Started: Hollow ring with solid background to mask connector line
    return "bg-zinc-950 border border-zinc-800";
  };

  // Node icon - only for completed and in_progress states
  const getNodeIcon = () => {
    if (isCompleted) return <Check size={14} strokeWidth={4} />;
    if (isInProgress) return <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />;
    // Not started & Locked: empty hollow ring (no icon)
    return null;
  };

  return (
    <div 
      className={`relative flex gap-4 group ${isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} 
      onClick={() => !isLocked && onClick(activity.id)}
    >
      {/* 1. Connector Line (Runs full height) */}
      {!isLast && (
        <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-800 -translate-x-1/2" />
      )}

      {/* 2. Status Node (32px Circle) */}
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center relative z-10 transition-colors ${getNodeStyle()}`}>
        {getNodeIcon()}
      </div>

      {/* 3. Content Area (With Padding for spacing) */}
      <div className="flex-grow pt-0.5 pb-8">
        
        {/* Top Row: Icon + Main Title */}
        <div className="flex items-center gap-3 mb-1">
          <Icon size={20} className="text-zinc-500 flex-shrink-0" />
          <span className={`text-base font-semibold truncate ${isCompleted || isInProgress ? 'text-zinc-200' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
            {activity.title}
          </span>
        </div>
        
        {/* Bottom Row: Type Tag (Indented to align with Text) */}
        <div className="pl-[32px] flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            {activity.type}
          </span>
          {activity.duration && (
            <span className="text-[10px] text-zinc-700 font-mono">
              • {activity.duration}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityItem;
