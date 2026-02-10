"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import CustomMarkdownView from "@/components/CodeEditor/CustomMarkdownView"
import type { ProjectPayload } from "../models"

interface ProjectContentPreviewProps {
  project: ProjectPayload
}

export function ProjectContentPreview({ project }: ProjectContentPreviewProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-primaryTextColor">{project.title || "Untitled Project"}</h3>
        {project.projectNumber > 0 && (
          <span className="text-sm text-gray-500">Project #{project.projectNumber}</span>
        )}
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-gray-700 dark:text-gray-300">{project.description}</p>
      )}

      {/* Category and Tags */}
      <div className="flex flex-wrap items-center gap-2">
        {project.category && (
          <Badge variant="outline">{project.category}</Badge>
        )}
        {project.tags.map((tag) => (
          <Badge key={tag} variant="secondary">{tag}</Badge>
        ))}
      </div>

      {/* Instructions */}
      {project.instructions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomMarkdownView markdown={project.instructions} />
          </CardContent>
        </Card>
      )}

      {/* Starter Files */}
      {Object.keys(project.starterFiles).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Starter Files</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {Object.keys(project.starterFiles).map((filename) => (
                <li key={filename} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-blue-600 dark:text-blue-400">{filename}</span>
                  <span className="text-gray-500">
                    ({project.starterFiles[filename].split('\n').length} lines)
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Test File Info */}
      {project.testFile.filename && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Test File</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
              {project.testFile.filename}
            </span>
            {project.testFile.content && (
              <span className="text-gray-500 text-sm ml-2">
                ({project.testFile.content.split('\n').length} lines)
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Limits */}
      {project.limits && (
        <div className="text-sm text-gray-500">
          Limits: {project.limits.timeoutMs}ms timeout, {project.limits.memoryMB}MB memory
        </div>
      )}
    </div>
  )
}
