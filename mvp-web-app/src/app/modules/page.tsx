"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { BookOpen } from "lucide-react"
import { Module as BackendModule } from "@/components/Admin/modules/ModuleList"
import { Module, Activity, ActivityStatus, ActivityType } from "@/components/types"
import CurriculumProgressPanel from "@/components/Module/CurriculumProgressPanel"
import ModuleCard from "@/components/Module/ModuleCard"
import { fetchWithAuth } from "@/lib/fetchWithAuth"
import { 
  isKnownContentType, 
  isBackendSupportedType,
  contentTypeToActivityTypeSafe 
} from "@/types/curriculum"

/**
 * Adapter: Convert backend Module format to frontend Module format.
 * 
 * IMPORTANT: This adapter handles the boundary between backend data and frontend types.
 * - Backend contract guarantees: "text" | "question"
 * - Frontend additionally handles: "video" | "project" (future-proofing)
 * - Unknown types render as "unknown" with a warning (never coerced)
 */
function adaptModuleFromBackend(
  backendModule: BackendModule,
  moduleIndex: number,
  completedIds: Set<string> = new Set(),
  currentId?: string
): Module {
  const activities: Activity[] = (backendModule.content ?? []).map((item, idx) => {
    const activityId = String(idx);
    const rawType = item.type as string;
    
    // Use safe adapter that warns on unknown types
    const activityType: ActivityType = contentTypeToActivityTypeSafe(rawType);
    
    // Determine activity status
    let status: ActivityStatus = 'not_started';
    if (completedIds.has(activityId)) {
      status = 'completed';
    } else if (currentId === activityId) {
      status = 'in_progress';
    }
    
    // Generate title based on type (explicit, no fallthrough)
    // Each type may store title in different locations
    let displayTitle: string;
    switch (activityType) {
      case 'reading':
        displayTitle = item.data?.title || `Reading ${idx + 1}`;
        break;
      case 'lecture':
        displayTitle = item.data?.title || `Lecture ${idx + 1}`;
        break;
      case 'question':
        // Questions may have title at root or nested in problemData
        displayTitle = item.data?.title || item.data?.problemData?.title || `Question ${idx + 1}`;
        break;
      case 'project':
        // Projects often use 'name' instead of 'title'
        displayTitle = item.data?.title || item.data?.name || `Project ${idx + 1}`;
        break;
      case 'unknown':
        displayTitle = item.data?.title || `Activity ${idx + 1}`;
        break;
    }
    
    return {
      id: activityId,
      title: displayTitle,
      type: activityType,
      status,
      duration: item.data?.duration ? `${item.data.duration} min` : undefined,
    };
  });

  // Calculate module-level status
  const completedCount = activities.filter(a => a.status === 'completed').length;
  const hasInProgress = activities.some(a => a.status === 'in_progress');
  const totalCount = activities.length;
  
  const moduleStatus = totalCount > 0 && completedCount === totalCount 
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

export default function Page() {
  const router = useRouter()
  const [backendModules, setBackendModules] = useState<BackendModule[]>([])
  const [loading, setLoading] = useState(true)
  // Map of moduleId -> Set of completed activity IDs
  const [progressByModule, setProgressByModule] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    const fetchModulesAndProgress = async () => {
      try {
        setLoading(true)
        
        // Fetch modules, progress, and resource lists in parallel
        const [modulesRes, progressRes, projectsRes, questionsRes] = await Promise.all([
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/progress`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/projects`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/problems`)
        ])
        
        if (!modulesRes.ok) throw new Error("Failed to fetch modules")
        let modulesData = await modulesRes.json()
        
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
        // For each module, hydrate any project/question content that has refId but null data
        // ---------------------------------------------------------
        const hydratedModules = modulesData.map((mod: any) => {
          if (!mod.content || !Array.isArray(mod.content)) return mod;
          
          const hydratedContent = mod.content.map((item: any) => {
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

            return item;
          });
          
          return { ...mod, content: hydratedContent };
        });
        
        setBackendModules(hydratedModules)
        // ---------------------------------------------------------
        
        // Load progress data
        if (progressRes.ok) {
          const progressData = await progressRes.json()
          // Convert the progress map to Record<string, Set<string>>
          const progressMap: Record<string, Set<string>> = {}
          if (progressData.progress) {
            for (const [moduleId, activityIds] of Object.entries(progressData.progress)) {
              progressMap[moduleId] = new Set(activityIds as string[])
            }
          }
          setProgressByModule(progressMap)
        }
      } catch (error) {
        // Error fetching modules
      } finally {
        setLoading(false)
      }
    }

    fetchModulesAndProgress()
  }, [])

  // Convert backend modules to the new Module format for the progress panel
  // Each module gets its own set of completed activity IDs
  const adaptedModules: Module[] = backendModules.map((m, index) => {
    const completedIds = progressByModule[m.ID] || new Set<string>()
    return adaptModuleFromBackend(m, index, completedIds)
  })

  const handleContinue = (moduleId: number | string, activityIndex: number) => {
    // Find the module to get its slug
    const foundModule = adaptedModules.find(m => m.id === moduleId || m.slug === String(moduleId))
    const moduleRef = foundModule?.slug || moduleId
    router.push(`/modules/${moduleRef}?index=${activityIndex}`)
  }

  const handleActivityClick = (moduleSlug: string, activityId: string) => {
    const targetModule = adaptedModules.find(m => m.slug === moduleSlug)
    const activityIndex = targetModule?.activities.findIndex(a => a.id === activityId) ?? 0
    router.push(`/modules/${moduleSlug}?index=${activityIndex}`)
  }

  return (
    <main className="flex-grow min-h-screen overflow-y-auto">
      {/* Sticky Header */}
      <header className="border-b border-zinc-800 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Modules</span>
            <span className="text-zinc-700">/</span>
            <span className="text-white font-semibold">Academy Curriculum</span>
          </div>
          <div className="flex items-center gap-4">
            <button className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              ?
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Page Title */}
        <div className="mb-10">
          <h1 className="text-4xl font-black text-white tracking-tight mb-3">
            Academy Curriculum
          </h1>
          <p className="text-zinc-400 max-w-2xl text-lg leading-relaxed">
            A structured learning path from memory basics to complex graph algorithms.
            Follow the recommended order for the best results.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-zinc-700 border-t-blue-500"></div>
              <p className="text-zinc-400 text-sm">Loading modules...</p>
            </div>
          </div>
        ) : backendModules.length === 0 ? (
          <div className="text-center py-24">
            <BookOpen className="mx-auto text-zinc-600 mb-4" size={48} />
            <p className="text-zinc-400">No modules available yet.</p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-10">
            {/* Main Content - Module Cards */}
            <div className="flex-grow space-y-8">
              {adaptedModules.map((module) => (
                <ModuleCard
                  key={module.slug}
                  module={module}
                  onActivityClick={(activityId) => handleActivityClick(module.slug, activityId)}
                />
              ))}
            </div>

            {/* Sidebar - Progress Panel */}
            <aside className="w-full lg:w-[320px] flex-shrink-0">
              <CurriculumProgressPanel 
                modules={adaptedModules} 
                onContinue={handleContinue}
              />
            </aside>
          </div>
        )}
      </div>
    </main>
  )
}
