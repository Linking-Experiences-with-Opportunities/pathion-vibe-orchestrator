
import React, { useState } from 'react';
import { ActivityGroup } from '../types';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import ActivityItem from './ActivityItem';

interface ReadingGroupItemProps {
  group: ActivityGroup;
  isLast: boolean;
  onActivityClick: (id: string) => void;
}

const ReadingGroupItem: React.FC<ReadingGroupItemProps> = ({ group, isLast, onActivityClick }) => {
  // Compute aggregated stats
  const totalCount = group.activities.length;
  const completedCount = group.activities.filter(a => a.status === 'completed').length;
  const firstInProgress = group.activities.find(a => a.status === 'in_progress') || group.activities.find(a => a.status === 'not_started');
  const isAllComplete = completedCount === totalCount;
  
  // Parse durations (assuming format "X min") to sum them up
  const totalMinutes = group.activities.reduce((acc, curr) => {
    const mins = parseInt(curr.duration?.split(' ')[0] || '0');
    return acc + mins;
  }, 0);

  // Default to collapsed as requested
  const [isExpanded, setIsExpanded] = useState(false);

  const handleMainClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Navigate to the next actionable reading
    if (firstInProgress) {
      onActivityClick(firstInProgress.id);
    } else if (group.activities.length > 0) {
      // If all done, go to the first one to review
      onActivityClick(group.activities[0].id);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="relative flex gap-4">
      {/* Connector Line */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-zinc-800 -z-0" />
      )}

      {/* Stacked Icon Effect */}
      <div className="relative z-10 pt-1">
        {/* Underneath card illusion */}
        <div className="absolute top-0.5 left-0.5 w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 -z-10" />
        
        <div 
            className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors cursor-pointer ${
                completedCount > 0 
                ? 'bg-blue-900/20 border-blue-500/50 text-blue-500' 
                : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={handleMainClick}
        >
            <BookOpen size={14} />
        </div>
      </div>

      <div className="pb-8 flex-grow">
        {/* Main Group Header Row */}
        <div 
            className="flex items-center justify-between group cursor-pointer p-3 -ml-3 -mt-2 rounded-xl hover:bg-zinc-800/30 transition-colors border border-transparent hover:border-zinc-800/50"
            onClick={handleMainClick}
        >
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors">
                        Reading: {group.title}
                    </span>
                    {/* Badge */}
                    <span className="text-[10px] font-bold bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-700">
                        {totalCount} Pages
                    </span>
                </div>
                
                <div className="flex items-center gap-3 text-[11px] text-zinc-500 font-medium">
                    <span className={completedCount > 0 ? "text-blue-400" : ""}>
                        {completedCount}/{totalCount} Complete
                    </span>
                    <span>&bull;</span>
                    <span>~{totalMinutes} min total</span>
                </div>
            </div>

            {/* Expand Toggle */}
            <button 
                onClick={handleExpandClick}
                className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
            >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
        </div>

        {/* Expanded Children List */}
        {isExpanded && (
            <div className="mt-2 pl-4 space-y-4 border-l border-zinc-800/50 animate-in slide-in-from-top-2 fade-in duration-300">
                {group.activities.map((activity, idx) => (
                    <div key={activity.id} className="relative">
                        <ActivityItem 
                            activity={activity} 
                            isLast={idx === group.activities.length - 1} 
                            onClick={onActivityClick} 
                        />
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};

export default ReadingGroupItem;
