'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Module, Activity, Status, ActivityStatus, ActivityType } from '../types';
import DonutChart from './DonutChart';
import ActivityItem from './ActivityItem';
import { Play, Check, CheckCircle2, Trophy, Clock, BookOpen, ArrowRight, Calendar, Target } from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetchWithAuth';

// Backend module format (from API)
interface BackendModule {
  ID: string;
  title: string;
  description?: string;
  content?: Array<{
    type: string;
    data: {
      title?: string;
      duration?: number;
      description?: string;
    };
  }>;
}

// Helper to adapt backend module to our Module format
function adaptModuleFromBackend(
  backendModule: BackendModule,
  moduleIndex: number,
  completedIds: Set<string> = new Set(),
  currentId?: string
): Module {
  const activities: Activity[] = (backendModule.content ?? []).map((item, idx) => {
    const activityId = String(idx);
    let activityType: ActivityType = 'reading';
    
    if (item.type === 'video') {
      activityType = 'lecture';
    } else if (item.type === 'question') {
      activityType = 'question';
    } else if (item.type === 'project') {
      activityType = 'project';
    }
    
    let status: ActivityStatus = 'not_started';
    if (completedIds.has(`${backendModule.ID}-${activityId}`)) {
      status = 'completed';
    } else if (currentId === `${backendModule.ID}-${activityId}`) {
      status = 'in_progress';
    }
    
    return {
      id: activityId,
      title: item.data?.title || `${activityType.charAt(0).toUpperCase() + activityType.slice(1)} ${idx + 1}`,
      type: activityType,
      status,
      duration: item.data?.duration ? `${item.data.duration} min` : undefined,
    };
  });

  // Calculate module-level status
  const completedCount = activities.filter(a => a.status === 'completed').length;
  const hasInProgress = activities.some(a => a.status === 'in_progress');
  const totalCount = activities.length;
  
  const moduleStatus: Status = totalCount > 0 && completedCount === totalCount 
    ? 'completed' 
    : hasInProgress || completedCount > 0 
      ? 'in_progress' 
      : 'not_started';

  return {
    id: moduleIndex + 1, // Use 1-based index for display
    slug: backendModule.ID,
    title: backendModule.title,
    description: backendModule.description || '',
    activities,
    status: moduleStatus,
  };
}

interface CurriculumProgressPanelProps {
  /** Optional modules array - if not provided, component will fetch its own data */
  modules?: Module[];
  onContinue?: (moduleId: number | string, activityIndex: number) => void;
  onActivityClick?: (moduleId: number | string, activityId: string) => void;
  showActivities?: boolean;
  /** Show roadmap of all modules */
  showRoadmap?: boolean;
  /** Show study plan CTA */
  showStudyPlanCTA?: boolean;
}

const CurriculumProgressPanel: React.FC<CurriculumProgressPanelProps> = ({ 
  modules: propModules, 
  onContinue,
  onActivityClick,
  showActivities = false,
  showRoadmap = false,
  showStudyPlanCTA = false
}) => {
  const router = useRouter();
  const [fetchedModules, setFetchedModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(!propModules);
  const [error, setError] = useState<string | null>(null);

  // Fetch modules if not provided as props
  useEffect(() => {
    if (propModules) {
      setLoading(false);
      return;
    }

    const fetchModules = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules`);
        
        if (!res.ok) {
          throw new Error('Failed to fetch modules');
        }
        
        const data: BackendModule[] = await res.json();
        const adaptedModules = data.map((m, index) => adaptModuleFromBackend(m, index));
        setFetchedModules(adaptedModules);
      } catch (err) {
        console.error('Error fetching modules:', err);
        setError('Failed to load modules');
      } finally {
        setLoading(false);
      }
    };

    fetchModules();
  }, [propModules]);

  // Use prop modules if provided, otherwise use fetched modules
  const modules = propModules || fetchedModules;
  
  // Aggregate stats from all modules
  const allActivities = modules.flatMap(m => m.activities);
  const completedActivities = allActivities.filter(a => a.status === 'completed').length;
  const inProgressActivities = allActivities.filter(a => a.status === 'in_progress').length;
  const notStartedActivities = allActivities.filter(a => a.status === 'not_started').length;
  const totalActivities = allActivities.length;
  
  // Module-level stats (for chart)
  // A module is "completed" if all activities are completed
  // A module is "in_progress" if it has any activity in_progress OR any completed activity (but not all)
  // A module is "not_started" only if all activities are not_started
  const completedModules = modules.filter(m => m.activities.length > 0 && m.activities.every(a => a.status === 'completed')).length;
  const inProgressModules = modules.filter(m => {
    const allDone = m.activities.length > 0 && m.activities.every(a => a.status === 'completed');
    const hasProgress = m.activities.some(a => a.status === 'in_progress' || a.status === 'completed');
    return !allDone && hasProgress;
  }).length;
  const notStartedModules = modules.filter(m => m.activities.length === 0 || m.activities.every(a => a.status === 'not_started')).length;
  
  // Find current active module and activity
  const activeModuleIndex = modules.findIndex(m => m.activities.some(a => a.status === 'in_progress'));
  const firstIncompleteModuleIndex = modules.findIndex(m => m.activities.some(a => a.status === 'not_started'));
  
  const currentModuleIndex = activeModuleIndex !== -1 ? activeModuleIndex : firstIncompleteModuleIndex;
  const activeModule = currentModuleIndex !== -1 ? modules[currentModuleIndex] : undefined;
  
  const activeActivityIndex = activeModule?.activities.findIndex(a => a.status === 'in_progress') ?? -1;
  const firstNotStartedIndex = activeModule?.activities.findIndex(a => a.status === 'not_started') ?? -1;
  const currentActivityIndex = activeActivityIndex !== -1 ? activeActivityIndex : firstNotStartedIndex;
  const activeActivity = currentActivityIndex !== -1 ? activeModule?.activities[currentActivityIndex] : undefined;

  // Find next module (first not started after current, or first not started overall)
  let nextModule = null;
  if (currentModuleIndex !== -1) {
    nextModule = modules.slice(currentModuleIndex + 1).find(m => m.activities.some(a => a.status === 'not_started'));
  }
  if (!nextModule) {
    nextModule = modules.find(m => m.activities.every(a => a.status === 'not_started'));
  }

  // Map modules to the chart data format
  const chartData = modules.map(m => {
    const done = m.activities.length > 0 && m.activities.every(a => a.status === 'completed');
    const inProgress = m.activities.some(a => a.status === 'in_progress' || (a.status === 'completed' && !done));
    return {
       id: String(m.id),
       status: (done ? 'completed' : inProgress ? 'in_progress' : 'not_started') as Status
    };
  });

  const handleContinue = () => {
    if (activeModule && currentActivityIndex !== -1) {
      if (onContinue) {
        onContinue(activeModule.id, currentActivityIndex);
      } else {
        const moduleRef = activeModule.slug || activeModule.id;
        router.push(`/modules/${moduleRef}?index=${currentActivityIndex}`);
      }
    }
  };

  const handleActivityClick = (activityId: string) => {
    if (activeModule) {
      if (onActivityClick) {
        onActivityClick(activeModule.id, activityId);
      } else {
        const activityIndex = activeModule.activities.findIndex(a => a.id === activityId);
        const moduleRef = activeModule.slug || activeModule.id;
        router.push(`/modules/${moduleRef}?index=${activityIndex}`);
      }
    }
  };

  // Calculate estimated time (rough estimate: 15 min per activity)
  const remainingActivities = totalActivities - completedActivities;
  const estimatedMinutes = remainingActivities * 15;
  const estimatedHours = Math.ceil(estimatedMinutes / 60);
  const timeDisplay = estimatedHours > 0 ? `~${estimatedHours}h` : 'Done!';

  // Loading state
  if (loading) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-6 h-fit sticky top-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-zinc-800 rounded w-3/4"></div>
          <div className="h-4 bg-zinc-800 rounded w-1/2"></div>
          <div className="h-32 bg-zinc-800 rounded-full w-32 mx-auto"></div>
          <div className="h-20 bg-zinc-800 rounded"></div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 h-fit sticky top-6">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-6 h-fit sticky top-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Curriculum Progress</h2>
        <p className="text-sm text-zinc-400">Track your learning journey</p>
      </div>

      {/* Donut Chart Section */}
      <div className="flex items-center gap-6">
        <DonutChart projects={chartData} />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-sm text-zinc-400">Completed ({completedModules})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-sm text-zinc-400">In Progress ({inProgressModules})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-zinc-600" />
            <span className="text-sm text-zinc-400">Not Started ({notStartedModules})</span>
          </div>
        </div>
      </div>

      {/* Current Focus & Next Up */}
      <div className="space-y-3">
        {activeModule && (
          <Link
            href={`/modules/${activeModule.slug || activeModule.id}${currentActivityIndex !== -1 ? `?index=${currentActivityIndex}` : ''}`}
            className="block rounded-xl bg-zinc-900/50 border border-zinc-800 p-4 transition-all duration-200 hover:border-blue-500/50 hover:bg-zinc-900/80"
          >
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold text-blue-500 uppercase tracking-wide">Current Focus</span>
            </div>
            <p className="text-white font-semibold">{activeModule.title}</p>
            {activeActivity && (
              <p className="text-xs text-zinc-500 mt-1">{activeActivity.title}</p>
            )}
          </Link>
        )}

        {nextModule && nextModule !== activeModule && (
          <Link
            href={`/modules/${nextModule.slug || nextModule.id}`}
            className="block rounded-xl bg-zinc-900/50 border border-zinc-800 p-4 transition-all duration-200 hover:border-blue-500/50 hover:bg-zinc-900/80"
          >
            <div className="flex items-center gap-2 mb-2">
              <ArrowRight className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Next Up</span>
            </div>
            <p className="text-zinc-400 group-hover:text-white transition-colors">{nextModule.title}</p>
          </Link>
        )}

        {!activeModule && !nextModule && completedModules === modules.length && modules.length > 0 && (
          <div className="rounded-xl bg-zinc-900/50 border border-green-500/30 p-4 text-center">
            <CheckCircle2 className="mx-auto text-green-500 mb-2" size={24} />
            <span className="text-green-500 font-semibold">All modules completed!</span>
          </div>
        )}
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800">
           <Trophy size={14} className="text-yellow-500 mb-1" />
           <p className="text-lg font-bold text-white leading-tight">
             {currentModuleIndex !== -1 ? currentModuleIndex + 1 : modules.length}
           </p>
           <p className="text-[10px] text-zinc-500 uppercase font-bold">Current Module</p>
        </div>
        <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800">
           <Clock size={14} className="text-blue-500 mb-1" />
           <p className="text-lg font-bold text-white leading-tight">{timeDisplay}</p>
           <p className="text-[10px] text-zinc-500 uppercase font-bold">Time to Done</p>
        </div>
      </div>

      {/* Activity List (optional) */}
      {showActivities && activeModule && activeModule.activities.length > 0 && (
        <>
          <div className="w-full h-px bg-zinc-800" />
          <div>
            <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-4">
              {activeModule.title}
            </p>
            <div className="space-y-0">
              {activeModule.activities.map((activity, idx) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  isLast={idx === activeModule.activities.length - 1}
                  onClick={handleActivityClick}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Roadmap (optional) */}
      {showRoadmap=false && modules.length > 0 && (
        <>
          <div className="w-full h-px bg-zinc-800" />
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Roadmap</h3>
            <div className="space-y-1">
              {modules.map((module, idx) => {
                const isComplete = module.activities.length > 0 && module.activities.every(a => a.status === 'completed');
                const isInProgress = module.activities.some(a => a.status === 'in_progress');
                const isCurrent = idx === currentModuleIndex;
                
                return (
                  <div key={module.id} className="relative">
                    {/* Connecting line */}
                    {idx < modules.length - 1 && (
                      <div className="absolute left-[11px] top-8 w-0.5 h-4 bg-zinc-800" />
                    )}
                    <Link
                      href={`/modules/${module.slug || module.id}`}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-200 ${
                        isCurrent 
                          ? 'bg-blue-500/10 border border-blue-500/30' 
                          : 'hover:bg-zinc-800/50'
                      }`}
                    >
                      {/* Badge - Perfect Circle */}
                      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold relative z-10 ${
                        isComplete 
                          ? 'bg-green-500 text-zinc-950' 
                          : isInProgress 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-zinc-900 border border-zinc-800 text-zinc-500'
                      }`}>
                        {isComplete ? <Check size={14} strokeWidth={3} /> : idx + 1}
                      </div>
                      <span className={`text-sm min-w-0 truncate ${
                        isComplete 
                          ? 'text-zinc-500' 
                          : isCurrent 
                            ? 'text-white font-medium' 
                            : 'text-zinc-400'
                      }`}>
                        {module.title}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Continue Button */}
      {activeActivity && activeModule && (
        <>
          <div className="w-full h-px bg-zinc-800" />
          <button 
            onClick={handleContinue}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 active:scale-[0.98]"
          >
            <Play size={16} fill="white" />
            CONTINUE
          </button>
        </>
      )}

      {/* Study Plan CTA (optional) */}
      {showStudyPlanCTA=false && (
        <Link
          href="/study-plan"
          className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-200 group"
        >
          <div className="p-2 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
            <Calendar className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-grow">
            <p className="text-white font-semibold text-sm">Create Study Plan</p>
            <p className="text-zinc-500 text-xs">Schedule your learning journey</p>
          </div>
          <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-blue-500 transition-colors" />
        </Link>
      )}
    </div>
  );
};

export default CurriculumProgressPanel;
