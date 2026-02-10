'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
// import { Progress } from '@/components/ui/progress'
import { calculatePercentage } from '@/lib/utils/dateUtils'
import { initProfileNanoFromUserGesture } from '@/lib/profileNanoEditor'

interface Project {
  id: string | number
  projectNumber?: number
  title: string
  description: string
  totalTests: number
  passedTests: number
  isCompleted?: boolean
}

interface ProjectCardProps {
  project: Project
  basePath?: string // defaults to '/projects'
}

export function ProjectCard({ project, basePath = '/projects' }: ProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  
  const completionPercentage = calculatePercentage(project.passedTests, project.totalTests);
  const isCompleted = project.isCompleted || (project.totalTests > 0 && project.passedTests === project.totalTests)
  const isStarted = project.totalTests > 0 && !isCompleted

  return (
    <Link
      href={`${basePath}/${project.id}`}
      onClick={() => { initProfileNanoFromUserGesture(); }}
      className="relative block h-[320px] rounded-xl bg-[#19191c] border border-neutral-900 border-[#262626] overflow-hidden transition-all duration-300 hover:border-[#0085ff]/50 dark:border-neutral-800"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Status Badge */}
      <div className="absolute top-4 right-4 z-10">
        {isCompleted ? (
          <Badge className="rounded-xl bg-[#1bc20d] text-white border-0 hover:bg-[#1bc20d]">
            Completed
          </Badge>
        ) : isStarted ? (
          <Badge className="rounded-xl bg-[#0085ff] text-white border-0 hover:bg-[#0085ff]">
            In Progress
          </Badge>
        ) : (
          <Badge variant="outline" className="rounded-xl bg-[#0c0c0c] text-[#aaaaaa] border-[#262626]">
            Not Started
          </Badge>
        )}
      </div>

      {/* Number Badge and Title */}
      <div className="absolute top-4 left-4 right-20 z-10 flex items-center gap-3">
        <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-[#262626] border border-neutral-900 border-[#0c0c0c] dark:border-neutral-800">
          <span className="text-xl font-bold text-white">{project.projectNumber || project.id}</span>
        </div>
        <h3 className="text-lg font-semibold text-[#FFFFFF] leading-tight">
          {project.title}
        </h3>
      </div>

      {/* Content Container */}
      <div className="absolute inset-0 flex flex-col justify-end px-6 pt-6 pb-10">
        {/* Progress Bar for In Progress items */}
        <div className="mb-3">
          {isStarted && !isCompleted && (
            <div className="w-full space-y-1">
              <div className="flex justify-between text-xs text-[#aaaaaa]">
                <span>{completionPercentage}% complete</span>
                <span>{project.passedTests}/{project.totalTests} tests</span>
              </div>
              {/* <Progress value={completionPercentage} className="h-1 bg-[#262626]" indicatorClassName="bg-[#0085ff]" /> */}
            </div>
          )}
        </div>

        {/* Description & Button - Fade in on Hover */}
        <div
          className={`transition-all duration-300 ${
            isHovered ? 'opacity-100 translate-y-0' : 'opacity-70 translate-y-4'
          }`}
        >
          <p className="text-sm text-[#aaaaaa] mb-4 line-clamp-3 leading-relaxed">
            {project.description}
          </p>
          <Button
            asChild
            variant="outline"
            className="w-full rounded-xl bg-transparent border-[#0085ff] text-[#0085ff] hover:bg-[#0085ff] hover:text-white transition-colors"
          >
            <div>
              {isCompleted ? 'Review Project' : isStarted ? 'Continue Learning' : 'Start Project'}
            </div>
          </Button>
        </div>
      </div>

      {/* Gradient Overlay for Better Text Readability */}
      {/* <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/60 to-transparent pointer-events-none" /> */}
    </Link>
  )
}
