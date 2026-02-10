"use client"

import { useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ProjectPayload } from "../models"

interface ProjectContentEditorProps {
  project: ProjectPayload
  onChange: (updates: ProjectPayload) => void
}

export function ProjectContentEditor({ project, onChange }: ProjectContentEditorProps) {
  const [newTag, setNewTag] = useState("")
  const [newFileName, setNewFileName] = useState("")

  const handleFieldChange = <K extends keyof ProjectPayload>(
    field: K,
    value: ProjectPayload[K]
  ) => {
    onChange({ ...project, [field]: value })
  }

  const handleLimitsChange = (field: "timeoutMs" | "memoryMB", value: number) => {
    onChange({
      ...project,
      limits: {
        timeoutMs: project.limits?.timeoutMs ?? 10000,
        memoryMB: project.limits?.memoryMB ?? 256,
        [field]: value,
      },
    })
  }

  const handleTestFileChange = (field: "filename" | "content", value: string) => {
    onChange({
      ...project,
      testFile: {
        ...project.testFile,
        [field]: value,
      },
    })
  }

  const handleStarterFileChange = (filename: string, content: string) => {
    onChange({
      ...project,
      starterFiles: {
        ...project.starterFiles,
        [filename]: content,
      },
    })
  }

  const handleAddStarterFile = () => {
    if (!newFileName.trim()) return
    if (project.starterFiles[newFileName]) {
      alert("A file with this name already exists")
      return
    }
    onChange({
      ...project,
      starterFiles: {
        ...project.starterFiles,
        [newFileName]: "",
      },
    })
    setNewFileName("")
  }

  const handleRemoveStarterFile = (filename: string) => {
    const { [filename]: _, ...rest } = project.starterFiles
    onChange({
      ...project,
      starterFiles: rest,
    })
  }

  const handleRenameStarterFile = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return
    if (project.starterFiles[newName]) {
      alert("A file with this name already exists")
      return
    }
    const content = project.starterFiles[oldName]
    const { [oldName]: _, ...rest } = project.starterFiles
    onChange({
      ...project,
      starterFiles: {
        ...rest,
        [newName]: content,
      },
    })
  }

  const handleAddTag = () => {
    if (!newTag.trim()) return
    if (project.tags.includes(newTag.trim())) return
    onChange({
      ...project,
      tags: [...project.tags, newTag.trim()],
    })
    setNewTag("")
  }

  const handleRemoveTag = (tag: string) => {
    onChange({
      ...project,
      tags: project.tags.filter((t) => t !== tag),
    })
  }

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="project-title">Project Title</Label>
          <Input
            id="project-title"
            value={project.title}
            onChange={(e) => handleFieldChange("title", e.target.value)}
            placeholder="Enter project title..."
          />
        </div>
        <div>
          <Label htmlFor="project-number">Project Number</Label>
          <Input
            id="project-number"
            type="number"
            value={project.projectNumber}
            onChange={(e) => handleFieldChange("projectNumber", parseInt(e.target.value) || 0)}
            placeholder="1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          id="project-description"
          value={project.description}
          onChange={(e) => handleFieldChange("description", e.target.value)}
          placeholder="Brief description of the project..."
          rows={3}
        />
      </div>

      <div>
        <Label htmlFor="project-instructions">Instructions (Markdown)</Label>
        <Textarea
          id="project-instructions"
          value={project.instructions}
          onChange={(e) => handleFieldChange("instructions", e.target.value)}
          placeholder="Full project instructions with markdown support..."
          rows={8}
          className="font-mono text-sm"
        />
      </div>

      {/* Category and Tags */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="project-category">Category</Label>
          <Input
            id="project-category"
            value={project.category}
            onChange={(e) => handleFieldChange("category", e.target.value)}
            placeholder="e.g., data-structures, algorithms..."
          />
        </div>
        <div>
          <Label>Tags</Label>
          <div className="flex gap-2">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add tag..."
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
            />
            <Button type="button" onClick={handleAddTag} size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {project.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Starter Files */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Starter Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.py"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddStarterFile())}
            />
            <Button type="button" onClick={handleAddStarterFile} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add File
            </Button>
          </div>

          {Object.entries(project.starterFiles).map(([filename, content]) => (
            <div key={filename} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Input
                  value={filename}
                  onChange={(e) => handleRenameStarterFile(filename, e.target.value)}
                  className="max-w-xs font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveStarterFile(filename)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={content}
                onChange={(e) => handleStarterFileChange(filename, e.target.value)}
                placeholder="File content..."
                rows={6}
                className="font-mono text-sm"
              />
            </div>
          ))}

          {Object.keys(project.starterFiles).length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">
              No starter files. Add files above.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test File */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Test File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="test-filename">Filename</Label>
            <Input
              id="test-filename"
              value={project.testFile.filename}
              onChange={(e) => handleTestFileChange("filename", e.target.value)}
              placeholder="test_main.py"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="test-content">Test Content</Label>
            <Textarea
              id="test-content"
              value={project.testFile.content}
              onChange={(e) => handleTestFileChange("content", e.target.value)}
              placeholder="# Test file content..."
              rows={10}
              className="font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Execution Limits */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Execution Limits (Optional)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                value={project.limits?.timeoutMs ?? 10000}
                onChange={(e) => handleLimitsChange("timeoutMs", parseInt(e.target.value) || 10000)}
                placeholder="10000"
              />
            </div>
            <div>
              <Label htmlFor="memory">Memory (MB)</Label>
              <Input
                id="memory"
                type="number"
                value={project.limits?.memoryMB ?? 256}
                onChange={(e) => handleLimitsChange("memoryMB", parseInt(e.target.value) || 256)}
                placeholder="256"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}