"use client"

import { useState, useEffect, Suspense, useCallback, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation";
import { Module } from "@/components/Admin/modules/ModuleList"
import { Module as FrontendModule, Activity as FrontendActivity } from "@/components/types"
import { fetchWithAuth } from "@/lib/fetchWithAuth"
import { Lesson, LessonKind } from "@/components/Module/types"
import { ActivityType } from "@/components/types"
import LessonContentLayout from "@/components/Module/LessonContextLayout"
import LessonContent from "@/components/Module/LessonContent"
import ModuleCodingProblem from "@/components/Module/ModuleCodingProblem"
import ProjectCodingPlatform from "@/components/ProjectPageRevamped/ProjectPageRevamped"
import ModuleCompletionScreen from "@/components/Module/ModuleCompletionScreen"
import ProgramCompletionScreen, { CurriculumStats } from "@/components/Module/CurriculumCompletion"
import { useModuleNavigation } from "@/contexts/module-navigation-context"
import { useNavbarVisibility } from "@/contexts/navbar-visibility-context"
import {
  isKnownContentType,
  isBackendSupportedType,
  ContentType,
  Activity
} from "@/types/curriculum"
import { calculateLessonDuration } from "@/lib/durationEstimates"
import { logLessonAction } from "@/lib/actionLogger"

/**
 * Maps raw backend content type to LessonKind.
 * 
 * IMPORTANT: Explicit handling per type — no fallthrough or coercion.
 * - Backend contract guarantees: "text" | "question" | "video" | "project"
 * - Unknown types return "unknown" with a warning
 */
function contentTypeToLessonKind(rawType: string): LessonKind {
  switch (rawType) {
    case "text":
      return "text";
    case "video":
      return "video";
    case "question":
      return "question";
    case "project":
      return "project";
    default:
      // Unknown type — warn and render as unknown
      console.warn(
        `[Curriculum] Unknown content type "${rawType}" received from backend. ` +
        `Expected one of: text, question, video, project. ` +
        `This content will render as a placeholder.`
      );
      return "unknown";
  }
}

function ModuleContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams()
  const { setNavigationState, setNavigationHandlers, clearNavigation } = useModuleNavigation();
  const { setNavbarHidden } = useNavbarVisibility();

  const [module, setModule] = useState<Module | undefined>(undefined)
  const [allModules, setAllModules] = useState<Module[]>([])
  const [allModulesProgress, setAllModulesProgress] = useState<{ [moduleId: string]: string[] }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCompletionScreen, setShowCompletionScreen] = useState(false)
  const [showCurriculumCompletion, setShowCurriculumCompletion] = useState(false)

  const { id } = params;
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0)
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set())
  const lessonStartTimeRef = useRef<number>(Date.now())

  /**
   * Derive lessons from module content.
   * 
   * IMPORTANT: Explicit switch per content type — no fallthrough.
   * Each type is handled explicitly; unknown types render as placeholder.
   * Memoized to prevent unnecessary re-renders.
   */
  const lessons: Lesson[] = useMemo(() => {
    return (module?.content ?? []).map((item, idx) => {
      const lessonId = String(idx);
      const rawType = item.type as string;
      const kind = contentTypeToLessonKind(rawType);
      
      // Explicit handling per type — no fallthrough
      switch (kind) {
        case "text":
          return {
            id: lessonId,
            title: item.data?.title || module?.title || "Reading",
            kind: "text" as const,
            markdown: item.data?.content,
            isCompleted: completedLessons.has(lessonId),
            description: item.data?.description,
            // Calculate reading time from word count
            estimatedDuration: calculateLessonDuration({
              kind: "text",
              markdown: item.data?.content,
            }),
          };
        
        case "video":
          // TODO: Backend does not yet persist video — this is frontend-only preview
          return {
            id: lessonId,
            title: item.data?.title || "Video Lesson",
            kind: "video" as const,
            videoUrl: item.data?.videoUrl,
            isCompleted: completedLessons.has(lessonId),
            description: item.data?.description,
            duration: item.data?.duration,
            // Use video duration from backend data
            estimatedDuration: calculateLessonDuration({
              kind: "video",
              videoDuration: item.data?.duration,
            }),
          };
        
        case "question":
          return {
            id: lessonId,
            title: item.data?.title || "Coding Question",
            kind: "question" as const,
            problemData: item.data,
            isCompleted: completedLessons.has(lessonId),
            description: item.data?.description,
            // Fixed estimate for coding questions
            estimatedDuration: calculateLessonDuration({ kind: "question" }),
          };
        
        case "project":
          // Use projectNumber (integer) which the API expects
          // Fallback to MongoDB _id only if projectNumber not available
          const realProjectId = item.data?.projectNumber || item.data?._id || item.data?.id || item.data?.projectId;

          return {
            id: lessonId, // Keep this as array index for navigation sequence
            title: item.data?.title || item.data?.name || "Project",
            kind: "project" as const,
            projectData: item.data,
            isCompleted: completedLessons.has(lessonId),
            description: item.data?.description,
            // Use project estimates from projectEstimates.ts
            estimatedDuration: calculateLessonDuration({
              kind: "project",
              projectId: realProjectId,
            }),
          };
        
        case "unknown":
          // Unknown type — render placeholder, never coerce to another type
          return {
            id: lessonId,
            title: item.data?.title || "Unknown Activity",
            kind: "unknown" as const,
            isCompleted: completedLessons.has(lessonId),
            description: "This content type is not yet supported.",
            estimatedDuration: calculateLessonDuration({ kind: "unknown" }),
          };
      }
    });
  }, [module?.content, module?.title, completedLessons]);

  const currentLesson = lessons[currentLessonIndex];

  // Handle URL index parameter
  useEffect(() => {
    const indexParam = searchParams.get("index")
    if (indexParam && module) {
      const parsedIndex = parseInt(indexParam)
      if (!isNaN(parsedIndex)) {
        if (parsedIndex >= (module.content?.length ?? 0)) {
          setCurrentLessonIndex((module.content?.length ?? 0) - 1)
        } else {
          setCurrentLessonIndex(parsedIndex)
        }
      }
    }
  }, [searchParams, module])

  // Track lesson start when lesson changes
  useEffect(() => {
    if (currentLesson && id) {
      lessonStartTimeRef.current = Date.now();
      logLessonAction("lesson_start", id, currentLesson.id, {
        lessonTitle: currentLesson.title,
        lessonKind: currentLesson.kind,
        lessonIndex: currentLessonIndex,
      });
    }
  }, [currentLessonIndex, currentLesson?.id, id])

  // Fetch module data, progress, and all modules (for next module and curriculum completion)
  useEffect(() => {
    const fetchModuleAndProgress = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch module, progress, all modules, all progress, and resource lists in parallel
        const [moduleRes, progressRes, allModulesRes, allProgressRes, projectsRes, questionsRes] = await Promise.all([
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${id}`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${id}/progress`),
          fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules`), // Public endpoint
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/progress`), // All modules progress
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/projects`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/problems`)
        ]);

        if (!moduleRes.ok) {
          if (moduleRes.status === 401) {
            throw new Error("You need to be logged in to access this content");
          } else if (moduleRes.status === 403) {
            throw new Error("You don't have permission to access this content. Please contact support.");
          } else {
            const errorText = await moduleRes.text();
            throw new Error(`Failed to fetch module: ${moduleRes.status} - ${errorText}`);
          }
        }

        let moduleData = await moduleRes.json()
        
        // Helper to extract MongoDB ObjectId string from various formats
        const extractId = (id: any): string | null => {
          if (!id) return null;
          if (typeof id === 'string') return id;
          if (typeof id === 'object' && id.$oid) return id.$oid; // MongoDB extended JSON format
          return String(id);
        };
        
        // Build lookup maps for projects and questions by their MongoDB _id
        let projectsMap: Record<string, any> = {};
        let questionsMap: Record<string, any> = {};
        
        if (projectsRes.ok) {
          const projectsData = await projectsRes.json();
          const projectsList = Array.isArray(projectsData.projects) ? projectsData.projects : [];
          projectsList.forEach((p: any) => {
            // Map by _id (handling $oid format), id, and projectNumber
            const idFromId = extractId(p._id);
            const idFromField = extractId(p.id);
            if (idFromId) projectsMap[idFromId] = p;
            if (idFromField) projectsMap[idFromField] = p;
            if (p.projectNumber) projectsMap[String(p.projectNumber)] = p;
          });
        }
        
        if (questionsRes.ok) {
          const questionsData = await questionsRes.json();
          const questionsList = Array.isArray(questionsData.problems) ? questionsData.problems : [];
          questionsList.forEach((q: any) => {
            const idFromId = extractId(q._id);
            const idFromField = extractId(q.id);
            if (idFromId) questionsMap[idFromId] = q;
            if (idFromField) questionsMap[idFromField] = q;
          });
        }
        
        // ---------------------------------------------------------
        // HYDRATION LOGIC
        // Iterate through content. If we find a refId but data is null, look it up!
        // ---------------------------------------------------------
        if (moduleData.content && Array.isArray(moduleData.content)) {
          const hydratedContent = moduleData.content.map((item: any) => {
            
            // CASE 1: Hydrate Project
            if (item.type === 'project' && !item.data && item.refId) {
              const project = projectsMap[item.refId];
              if (project) return { ...item, data: project };
            }
            
            // CASE 2: Hydrate Question
            if (item.type === 'question' && !item.data && item.refId) {
              const question = questionsMap[item.refId];
              if (question) return { ...item, data: question };
            }

            // Return item as-is if no hydration needed
            return item;
          });
          
          // Update the module data with the fully loaded content
          moduleData.content = hydratedContent;
        }
        // ---------------------------------------------------------
        
        setModule(moduleData)

        // Load completed lessons from backend
        if (progressRes.ok) {
          const progressData = await progressRes.json();
          if (progressData.completedActivityIds) {
            setCompletedLessons(new Set(progressData.completedActivityIds));
          }
        }

        // Load all modules for determining next module
        if (allModulesRes.ok) {
          const allModulesData = await allModulesRes.json();
          setAllModules(allModulesData);
        }

        // Load all modules progress for curriculum completion check
        if (allProgressRes.ok) {
          const allProgressData = await allProgressRes.json();
          if (allProgressData.progress) {
            setAllModulesProgress(allProgressData.progress);
          }
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load module')
      } finally {
        setLoading(false)
      }
    }

    fetchModuleAndProgress()
  }, [id])

  // Handlers
  const handleCompleteLesson = async () => {
    if (!currentLesson || completedLessons.has(currentLesson.id)) return;
    
    // Calculate time spent on lesson
    const timeOnLesson = Date.now() - lessonStartTimeRef.current;
    
    // Optimistic update - immediately show as completed
    const previousState = new Set(completedLessons);
    setCompletedLessons(prev => {
      const newSet = new Set(Array.from(prev));
      newSet.add(currentLesson.id);
      return newSet;
    });

    // Log lesson completion
    logLessonAction("lesson_complete", id, currentLesson.id, {
      lessonTitle: currentLesson.title,
      lessonKind: currentLesson.kind,
      lessonIndex: currentLessonIndex,
      timeOnLesson,
    });

    // Save to backend
    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${id}/progress`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityId: currentLesson.id })
        }
      );
      
      if (!res.ok) {
        throw new Error('Failed to save progress');
      }
    } catch (error) {
      // Revert on error
      setCompletedLessons(previousState);
    }
  };

  const goToNextLesson = useCallback(async () => {
    if (currentLessonIndex + 1 >= lessons.length) {
      // On last lesson - mark as complete and show completion screen
      if (currentLesson && !completedLessons.has(currentLesson.id)) {
        // Mark current lesson complete before showing completion screen
        const previousState = new Set(completedLessons);
        setCompletedLessons(prev => {
          const newSet = new Set(Array.from(prev));
          newSet.add(currentLesson.id);
          return newSet;
        });

        // Save to backend
        try {
          await fetchWithAuth(
            `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${id}/progress`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ activityId: currentLesson.id })
            }
          );
        } catch (error) {
          setCompletedLessons(previousState);
        }
      }
      setShowCompletionScreen(true);
      return;
    }
    setCurrentLessonIndex(prev => prev + 1);
  }, [currentLessonIndex, lessons.length, currentLesson, completedLessons, id]);

  const goToPrevLesson = useCallback(() => {
    if (currentLessonIndex === 0) {
      // On first lesson, go back to modules list
      router.push("/modules");
      return;
    }
    setCurrentLessonIndex(prev => prev - 1);
  }, [currentLessonIndex, router]);

  // When user passes all test cases, mark the lesson as complete
  // Shows the module completion screen only if this was the last lesson
  const handleAllTestsPassed = useCallback(async () => {
    if (!currentLesson) return;
    if (!completedLessons.has(currentLesson.id)) {
      const previousState = new Set(completedLessons);
      setCompletedLessons(prev => {
        const newSet = new Set(Array.from(prev));
        newSet.add(currentLesson.id);
        return newSet;
      });
      try {
        await fetchWithAuth(
          `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${id}/progress`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activityId: currentLesson.id })
          }
        );
      } catch {
        setCompletedLessons(previousState);
      }
    }
    // Show completion screen only on the last lesson
    if (currentLessonIndex === lessons.length - 1) {
      setShowCompletionScreen(true);
    }
  }, [currentLesson, currentLessonIndex, lessons.length, completedLessons, id]);

  const handleBack = () => {
    router.push("/modules")
  };

  // Convert content type to ActivityType (for completion screen adapter)
  const mapContentTypeToActivityType = useCallback((type: string): ActivityType => {
    switch (type) {
      case "text": return "reading";
      case "video": return "lecture";
      case "question": return "question";
      case "project": return "project";
      default: return "unknown";
    }
  }, []);

  // Adapt backend Module to frontend Module format for completion screen
  const adaptModuleToFrontend = useCallback((backendModule: Module): FrontendModule => {
    const activities: FrontendActivity[] = (backendModule.content ?? []).map((item, idx) => {
      
      let displayTitle = "Activity";

      // --- SEPARATE LOGIC PER TYPE ---
      if (item.type === "project") {
        // Projects often have 'name' or 'title' at the root of their data object
        displayTitle = item.data?.title || item.data?.name || "Project";
      } 
      else if (item.type === "question") {
        // Questions usually have a 'problemData' object or a direct title
        displayTitle = item.data?.title || item.data?.problemData?.title || "Coding Question";
      } 
      else if (item.type === "text" || item.type === "video") {
        // Simple content usually has 'title' directly on data
        displayTitle = item.data?.title || "Lesson";
      }
      
      return {
        id: String(idx),
        type: mapContentTypeToActivityType(item.type),
        title: displayTitle,
        status: "not_started" as const,
      };
    });

    return {
      id: backendModule.ID || 0,
      slug: backendModule.ID || "",
      title: backendModule.title,
      description: backendModule.description || "",
      activities,
    };
  }, [mapContentTypeToActivityType]);

  // Find the next module in sequence
  const nextModule = useMemo((): FrontendModule | null => {
    if (!module || allModules.length === 0) return null;
    
    const currentIndex = allModules.findIndex(m => m.ID === module.ID);
    
    if (currentIndex === -1 || currentIndex >= allModules.length - 1) {
      return null;
    }
    
    const next = allModules[currentIndex + 1];
    return adaptModuleToFrontend(next);
  }, [module, allModules, adaptModuleToFrontend]);

  // Current module adapted for completion screen
  const currentModuleForCompletion = useMemo((): FrontendModule | null => {
    if (!module) return null;
    return adaptModuleToFrontend(module);
  }, [module, adaptModuleToFrontend]);

  // Calculate curriculum-wide stats for curriculum completion screen
  const curriculumStats = useMemo((): CurriculumStats => {
    const totalModules = allModules.length;
    
    // Count total activities across all modules
    const totalActivities = allModules.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    
    // Count completed activities across all modules
    let activitiesCompleted = 0;
    let modulesCompleted = 0;
    
    allModules.forEach(m => {
      const moduleId = m.ID;
      const moduleActivityCount = m.content?.length ?? 0;
      const completedInModule = allModulesProgress[moduleId]?.length ?? 0;
      
      activitiesCompleted += completedInModule;
      
      if (moduleActivityCount > 0 && completedInModule >= moduleActivityCount) {
        modulesCompleted++;
      }
    });
    
    return {
      modulesCompleted,
      totalModules,
      activitiesCompleted,
      totalActivities,
    };
  }, [allModules, allModulesProgress]);

  // Check if all modules in curriculum are complete
  const isCurriculumComplete = useMemo(() => {
    if (allModules.length === 0) return false;
    return curriculumStats.modulesCompleted >= curriculumStats.totalModules;
  }, [allModules.length, curriculumStats]);

  // Handle completion screen actions
  const handleContinueFromCompletion = () => {
    // Check if this was the last module - show curriculum completion
    if (!nextModule && isCurriculumComplete) {
      setShowCompletionScreen(false);
      setShowCurriculumCompletion(true);
    } else if (nextModule) {
      router.push(`/modules/${nextModule.slug}`);
    } else {
      router.push("/modules");
    }
  };

  const handleBackToModulesFromCompletion = () => {
    router.push("/modules");
  };

  // Curriculum completion handlers
  const handleCurriculumContinue = () => {
    // Navigate to mock interview claim or next step
    router.push("/modules"); // For now, go back to modules
  };

  const handleCurriculumDismiss = () => {
    setShowCurriculumCompletion(false);
    router.push("/modules");
  };

  // Update module navigation context for top bar
  // Separate effect for setting up handlers (only on mount/unmount)
  useEffect(() => {
    setNavigationHandlers({
      onPrev: goToPrevLesson,
      onNext: goToNextLesson,
    });
    
    return () => {
      clearNavigation();
    };
  }, [setNavigationHandlers, clearNavigation, goToPrevLesson, goToNextLesson]);

  // Memoize values for navigation state to prevent unnecessary updates
  const moduleTitle = module?.title;
  const currentLessonTitle = currentLesson?.title;
  const lessonsCount = lessons.length;
  
  // Calculate module number (1-indexed position in curriculum)
  const moduleNumber = useMemo(() => {
    if (!module || allModules.length === 0) return 1;
    const index = allModules.findIndex(m => m.ID === module.ID);
    return index === -1 ? 1 : index + 1;
  }, [module, allModules]);

  // Separate effect for updating navigation state (when lesson changes)
  useEffect(() => {
    if (moduleTitle && currentLessonTitle && lessonsCount > 0) {
      setNavigationState({
        currentIndex: currentLessonIndex,
        totalCount: lessonsCount,
        moduleTitle: moduleTitle,
        currentLessonTitle: currentLessonTitle,
        moduleNumber: moduleNumber,
      });
    }
  }, [moduleTitle, currentLessonTitle, currentLessonIndex, lessonsCount, moduleNumber, setNavigationState]);

  // Conditionally hide navbar for project and question lessons
  useEffect(() => {
    if (currentLesson?.kind === 'project' || currentLesson?.kind === 'question') {
      setNavbarHidden(true);
    } else {
      setNavbarHidden(false);
    }

    // Cleanup: restore navbar when component unmounts
    return () => setNavbarHidden(false);
  }, [currentLesson?.kind, setNavbarHidden]);

  // Convert lesson kind to ActivityType for LessonContentLayout
  // IMPORTANT: Explicit mapping per type — no fallthrough
  const getActivityType = (kind: Lesson['kind']): ActivityType => {
    switch (kind) {
      case 'text': return 'reading';
      case 'video': return 'lecture';
      case 'question': return 'question';
      case 'project': return 'project';
      case 'unknown': return 'unknown';
    }
  };

  // Compute navigation state for lesson content
  // Always true - on first lesson, prev goes back to /modules
  const hasPrev = true;
  
  // Check if on last lesson
  const isLastLesson = currentLessonIndex === lessons.length - 1;
  
  // Check if all OTHER lessons are complete (excluding current)
  const allOtherLessonsComplete = lessons.every((lesson, idx) => 
    idx === currentLessonIndex || lesson.isCompleted
  );
  
  // Show "Complete Module" when on last lesson and all others are done
  const showCompleteModule = isLastLesson && allOtherLessonsComplete;
  
  // Get next activity for context-aware forward button
  const nextActivity: Activity | null = currentLessonIndex < lessons.length - 1 
    ? {
        id: lessons[currentLessonIndex + 1].id,
        type: getActivityType(lessons[currentLessonIndex + 1].kind),
        title: lessons[currentLessonIndex + 1].title,
        status: lessons[currentLessonIndex + 1].isCompleted ? 'completed' : 'not_started',
      }
    : null;

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen text-slate-200 flex items-center justify-center relative">
        {/* Background Effects */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        </div>
        <div className="relative z-20 flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-700 border-t-cyan-500"></div>
          <p className="text-slate-400 text-sm font-medium">Loading module...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="min-h-screen text-slate-200 flex items-center justify-center p-6 relative">
        {/* Background Effects */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-500/10 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-20 max-w-md w-full pointer-events-auto">
          <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-xl backdrop-blur-sm">
            <h2 className="text-lg font-semibold text-red-400 mb-2">Error Loading Module</h2>
            <p className="text-sm text-slate-300">{error}</p>
            <button
              onClick={() => router.push('/modules')}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm cursor-pointer"
            >
              Back to Modules
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty State
  if (!module || !currentLesson) {
    return (
      <div className="min-h-screen text-slate-200 flex items-center justify-center p-6 relative">
        <div className="relative z-20 max-w-md w-full text-center pointer-events-auto">
          <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl">
            <h2 className="text-lg font-semibold text-slate-300 mb-2">No Content Available</h2>
            <p className="text-sm text-slate-500">This module doesn&apos;t have any content yet.</p>
            <button
              onClick={() => router.push('/modules')}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm cursor-pointer"
            >
              Back to Modules
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Curriculum Completion Screen (entire curriculum finished)
  if (showCurriculumCompletion) {
    return (
      <ProgramCompletionScreen
        onContinue={handleCurriculumContinue}
        onDismiss={handleCurriculumDismiss}
        stats={curriculumStats}
      />
    );
  }

  // Module Completion Screen
  if (showCompletionScreen && currentModuleForCompletion) {
    return (
      <ModuleCompletionScreen
        module={currentModuleForCompletion}
        nextModule={nextModule}
        onContinue={handleContinueFromCompletion}
        onBackToModules={handleBackToModulesFromCompletion}
      />
    );
  }

  /**
   * Render content based on lesson kind.
   * 
   * IMPORTANT: Explicit rendering per type — no fallthrough.
   * - "question" gets full-width coding layout
   * - "project" gets dedicated project layout
   * - "text" and "video" use LessonContentLayout
   * - "unknown" renders a placeholder warning
   */
  const renderLessonContent = () => {
    switch (currentLesson.kind) {
      case 'question':
        // Coding question gets full-width layout
        return (
          <ModuleCodingProblem
            contentIndex={currentLessonIndex}
            problemData={currentLesson.problemData}
            module={module}
            onAllTestsPassed={handleAllTestsPassed}
          />
        );
      
      case 'project':
        // Project gets full coding platform with editor
        // Use projectNumber (integer) which the API expects, NOT the MongoDB _id
        // Convert to string since the component expects a string
        const rawProjectId = currentLesson.projectData?.projectNumber 
          || currentLesson.projectData?._id 
          || currentLesson.projectData?.id 
          || currentLesson.projectData?.projectId;
        const validProjectId = rawProjectId ? String(rawProjectId) : null;

        if (!validProjectId) {
          return (
            <div className="p-8 text-center">
              <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-xl max-w-md mx-auto">
                <h2 className="text-lg font-semibold text-red-400 mb-2">
                  Missing Project Link
                </h2>
                <p className="text-sm text-slate-300">
                  This project module is missing a valid Project ID. Please re-select the project in the Admin Module Creator and save the module.
                </p>
                <button
                  onClick={goToNextLesson}
                  className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm cursor-pointer"
                >
                  Skip to Next
                </button>
              </div>
            </div>
          );
        }

        return (
          <ProjectCodingPlatform
            projectId={validProjectId}
            initialData={currentLesson.projectData}
            onAllTestsPassed={handleAllTestsPassed}
          />
        );
      
      case 'text':
      case 'video':
        // Text and video lessons use LessonContentLayout
        return (
          <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto h-full">
            <LessonContentLayout
              title={currentLesson.title}
              moduleTitle={module.title}
              type={getActivityType(currentLesson.kind)}
              duration={currentLesson.estimatedDuration}
              isCompleted={currentLesson.isCompleted}
              onBack={handleBack}
              onComplete={handleCompleteLesson}
              onNext={goToNextLesson}
              hasPrev={hasPrev}
              onPrev={goToPrevLesson}
              nextActivity={nextActivity}
              showCompleteModule={showCompleteModule}
            >
              <LessonContent 
                lesson={currentLesson} 
                onVideoEnd={handleCompleteLesson}
              />
            </LessonContentLayout>
          </div>
        );
      
      case 'unknown':
        // Unknown type — render placeholder, never crash or coerce
        return (
          <div className="p-6 lg:p-10 xl:p-14 max-w-6xl mx-auto pointer-events-auto">
            <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <h2 className="text-lg font-semibold text-amber-400 mb-2">
                Unsupported Content Type
              </h2>
              <p className="text-sm text-slate-300">
                This content type is not yet supported. Please contact support if you believe this is an error.
              </p>
              <button
                onClick={goToNextLesson}
                className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors text-sm cursor-pointer"
              >
                Skip to Next
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen text-slate-200 font-sans selection:bg-cyan-500/30 selection:text-cyan-100 flex flex-col overflow-hidden relative">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '64px 64px'
          }}
        ></div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth relative z-10 pointer-events-auto">
        {renderLessonContent()}
      </main>

      {/* Custom Scrollbar Styles - inline for this page */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.7);
        }
      `}</style>
    </div>
  )
}

export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen  text-slate-200 flex items-center justify-center">
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-700 border-t-cyan-500"></div>
          <p className="text-slate-400 text-sm font-medium">Loading module...</p>
        </div>
      </div>
    }>
      <ModuleContent params={params} />
    </Suspense>
  )
}
