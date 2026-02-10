'use client'

import { Check, Play, Lock } from 'lucide-react'

export type ProjectStatus = 'not_started' | 'in_progress' | 'completed'

interface RoadmapProject {
  id: number | string
  name: string
  status: ProjectStatus
}

interface RoadmapProps {
  projects: RoadmapProject[]
}

export function Roadmap({ projects }: RoadmapProps) {
  const getStatusIcon = (status: ProjectStatus) => {
    switch (status) {
      case 'completed':
        return <Check size={14} strokeWidth={3} />
      case 'in_progress':
        return <Play size={14} fill="currentColor" />
      case 'not_started':
      default:
        return null
    }
  }

  const getNodeStyle = (status: ProjectStatus) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500 text-zinc-950'
      case 'in_progress':
        return 'bg-zinc-950 border-2 border-blue-500 text-blue-500'
      case 'not_started':
      default:
        return 'bg-zinc-950 border border-zinc-800 text-zinc-600'
    }
  }

  const getStatusLabel = (status: ProjectStatus) => {
    switch (status) {
      case 'completed':
        return <span className="text-xs text-green-500 flex-shrink-0">Completed</span>
      case 'in_progress':
        return <span className="text-xs text-blue-500 flex-shrink-0">In Progress</span>
      case 'not_started':
      default:
        return <span className="text-xs text-zinc-500 flex-shrink-0">Not Started</span>
    }
  }

  return (
    <div>
      {projects.map((project, index) => {
        const isLast = index === projects.length - 1

        return (
          <div key={project.id} className={`relative ${!isLast ? 'pb-6' : ''} flex gap-3`}>
            {/* Connector Line - Full height, centered behind icon */}
            {!isLast && (
              <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-800 -translate-x-1/2" />
            )}

            {/* Node - 32px circle with z-10 to mask line */}
            <div className={`relative z-10 w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${getNodeStyle(project.status)}`}>
              {getStatusIcon(project.status)}
            </div>

            {/* Content - pt-1 for optical alignment */}
            <div className="pt-1 flex-1 flex items-center justify-between min-w-0">
              <span className="text-sm text-white truncate">{project.name}</span>
              {getStatusLabel(project.status)}
            </div>
          </div>
        )
      })}
    </div>
  )
}