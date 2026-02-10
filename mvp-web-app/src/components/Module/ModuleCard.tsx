import React, { useState } from 'react';
import { Module, Status } from '../types';
import { Check, Play, Lock, ChevronDown, ChevronUp, BookOpen, Code, Terminal, PlayCircle } from 'lucide-react';
import { groupModuleActivities } from '../../lib/utils/grouping';
import ReadingGroupItem from './ReadingGroupItem';
import ActivityItem from './ActivityItem';

interface ModuleCardProps {
  module: Module;
  onActivityClick: (activityId: string) => void;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module, onActivityClick }) => {
  // Calculate module status from activities if not provided
  const completedCount = module.activities.filter(a => a.status === 'completed').length;
  const hasInProgress = module.activities.some(a => a.status === 'in_progress');
  const totalCount = module.activities.length;
  
  const moduleStatus: Status = module.status || (
    totalCount > 0 && completedCount === totalCount 
      ? 'completed' 
      : hasInProgress || completedCount > 0 
        ? 'in_progress' 
        : 'not_started'
  );
  
  const [isExpanded, setIsExpanded] = useState(moduleStatus === 'in_progress' || String(module.id) === '1');

  // Calculate Progress
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Group consecutive reading activities for cleaner timeline
  const groupedActivities = groupModuleActivities(module.activities);

  return (
    <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Card Header */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-6 cursor-pointer select-none"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex gap-4 items-start">
            {/* Module Number Badge - Matches ActivityItem 32px circles */}
            <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold ${
              moduleStatus === 'completed' ? 'bg-green-500 text-zinc-950' :
              moduleStatus === 'in_progress' ? 'bg-blue-600 text-white' :
              'bg-zinc-950 border border-zinc-800 text-zinc-400'
            }`}>
              {moduleStatus === 'completed' ? <Check size={14} strokeWidth={3} /> : module.id}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold text-white">{module.title}</h3>
              <p className="text-zinc-500 text-sm mt-1 line-clamp-1">
                {module.description.length > 120 
                  ? `${module.description.slice(0, 120)}...` 
                  : module.description}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             {moduleStatus === 'completed' && (
                 <span className="hidden sm:inline-block bg-green-500/10 text-green-500 text-xs font-bold px-3 py-1 rounded-full border border-green-500/20">
                   100% Complete
                 </span>
             )}
             {isExpanded ? <ChevronUp className="text-zinc-500" /> : <ChevronDown className="text-zinc-500" />}
          </div>
        </div>

        {/* Header Progress Bar (Visible when Collapsed) */}
        {!isExpanded && (
          <div className="w-full bg-zinc-800 h-1 rounded-full mt-4 overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${moduleStatus === 'completed' ? 'bg-green-500' : 'bg-blue-600'}`} 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Vertical Activities Timeline */}
      {isExpanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/30 p-6 pt-4">
          <div className="relative pl-2">
            <div>
              {groupedActivities.map((item, index) => {
                const isLast = index === groupedActivities.length - 1;

                // Check if this is a grouped item (reading group)
                if ('type' in item && item.type === 'group') {
                  return (
                    <ReadingGroupItem
                      key={`group-${index}`}
                      group={item}
                      isLast={isLast}
                      onActivityClick={onActivityClick}
                    />
                  );
                }

                // Regular activity item
                return (
                  <ActivityItem
                    key={item.id}
                    activity={item}
                    isLast={isLast}
                    onClick={onActivityClick}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuleCard;