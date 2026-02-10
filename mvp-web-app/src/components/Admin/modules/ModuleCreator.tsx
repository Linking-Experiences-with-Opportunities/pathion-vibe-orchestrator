"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Plus, Trash2, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ContentEditor } from "@/components/Admin/modules/ContentEditor"
import CustomMarkdownView from "@/components/CodeEditor/CustomMarkdownView"
import { fetchWithAuth } from "@/lib/fetchWithAuth"
import { getS3Url } from "@/lib/utils"
import type { ContentType } from "@/types/curriculum"

// Local ContentItem interface - uses `any` for data until full type migration
interface ContentItem {
  id: string
  type: ContentType
  data: any
  refId?: string  // Reference ID for question/project content items (from backend)
}

// Helper function to convert any YouTube URL to embed format
function getYouTubeEmbedUrl(url: string): string {
  if (!url) return "";
  if (url.includes("youtube.com/watch")) {
    const videoId = url.split("v=")[1]?.split("&")[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }
  if (url.includes("youtu.be/")) {
    const videoId = url.split("youtu.be/")[1]?.split("?")[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }
  if (url.includes("youtube.com/embed/")) {
    return url;
  }
  return url;
}

function isYouTubeUrl(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function getVideoUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return getS3Url(url);
  }
  return getS3Url(`/lecture-videos/${url}`);
}

export function ModuleCreator({
  mode = "create",
  moduleId
}: {
  mode?: "create" | "edit";
  moduleId?: string;
}) {
  const [moduleTitle, setModuleTitle] = useState("")
  const [moduleDescription, setModuleDescription] = useState("")
  const [contentItems, setContentItems] = useState<ContentItem[]>([])
  const [previewMode, setPreviewMode] = useState(false)

  // Resources for selection
  const [availableQuestions, setAvailableQuestions] = useState<any[]>([])
  const [availableProjects, setAvailableProjects] = useState<any[]>([])
  
  // NEW: Explicit loading state
  const [isLoadingResources, setIsLoadingResources] = useState(true)

  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Fetch Module Data (Edit Mode)
  useEffect(() => {
    if (!moduleId) return

    const fetchModule = async () => {
      try {
        const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/modules/${moduleId}`)
        if (!res.ok) throw new Error("Failed to fetch module")
        const data = await res.json()
        
        setModuleTitle(data.title)
        setModuleDescription(data.description)
        setContentItems(data.content)
      } catch (err: any) {
        console.error("error fetching module: ", err)
        alert("Failed to load module data")
      }
    }

    fetchModule()
  }, [moduleId])

  // Fetch Available Questions and Projects
  useEffect(() => {
    const fetchResources = async () => {
      // Ensure loading is true at start
      setIsLoadingResources(true)
      try {
        const [questionsRes, projectsRes] = await Promise.all([
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/problems`),
          fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/projects`)
        ])

        if (questionsRes.ok) {
          const questionsData = await questionsRes.json()
          const cleanQuestions = Array.isArray(questionsData.problems) ? questionsData.problems : []
          setAvailableQuestions(cleanQuestions)
        }

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json()
          const cleanProjects = Array.isArray(projectsData.projects) ? projectsData.projects : []
          setAvailableProjects(cleanProjects)
        }
      } catch (error) {
        console.error("Error fetching resources:", error)
      } finally {
        // NEW: Always turn off loading, even if error or empty
        setIsLoadingResources(false)
      }
    }
    fetchResources()
  }, [])

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverItem(itemId)
  }

  const handleDragLeave = () => {
    setDragOverItem(null)
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()

    if (!draggedItem || draggedItem === targetId) {
      setDraggedItem(null)
      setDragOverItem(null)
      return
    }

    const draggedIndex = contentItems.findIndex((item) => item.id === draggedItem)
    const targetIndex = contentItems.findIndex((item) => item.id === targetId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newItems = [...contentItems]
    const [removed] = newItems.splice(draggedIndex, 1)
    newItems.splice(targetIndex, 0, removed)

    setContentItems(newItems)
    setDraggedItem(null)
    setDragOverItem(null)
  }

  const handleSaveModule = async () => {
    if (isSaving) return
    if (!moduleTitle.trim()) {
      alert("Please enter a module title");
      return;
    }
    if (contentItems.length === 0) {
      alert("You must add at least one content item.");
      return;
    }

    // Validate that all reference items (projects/questions) have a valid MongoDB ObjectID
    const isValidObjId = (id: any): boolean => {
      if (!id) return false;
      const str = String(id);
      // Must be 24 hex chars AND not the zero ObjectID
      return /^[a-f0-9]{24}$/i.test(str) && str !== "000000000000000000000000";
    };
    
    const invalidItems = contentItems.filter(
      item => (item.type === "question" || item.type === "project") && 
              !isValidObjId(item.data?._id) && !isValidObjId(item.data?.id)
    );
    
    if (invalidItems.length > 0) {
      const invalidIndices = invalidItems.map(item => contentItems.indexOf(item) + 1).join(", ");
      alert(`Please select a valid resource for content item(s) at position(s): ${invalidIndices}. Look for items showing a dropdown selector.`);
      return;
    }

    const payload = {
      title: moduleTitle,
      description: moduleDescription,
      content: contentItems,
    }
    
    const url = mode === "edit"
      ? `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/module/${moduleId}`
      : `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/module`
    const method = mode === "edit" ? "PUT" : "POST"

    setIsSaving(true)
    try {
      const res = await fetchWithAuth(url, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Failed to save module:", res.status, errorText);
        alert(`Failed to save module: ${res.status}. ${errorText || res.statusText}`);
        setIsSaving(false)
        return;
      }

      setTimeout(() => {
        window.location.replace("/admin/modules")
      }, 0)
    } catch (err) {
      console.error("Error saving module:", err);
      alert(`Error saving module: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsSaving(false)
    }
  }

  const moveItem = (fromIndex: number, direction: "up" | "down") => {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1
    if (toIndex < 0 || toIndex >= contentItems.length) return

    const newItems = [...contentItems]
    const [removed] = newItems.splice(fromIndex, 1)
    newItems.splice(toIndex, 0, removed)
    setContentItems(newItems)
  }

  const addContentItem = (type: "text" | "question" | "video" | "project") => {
    let data: any;
    if (type === "text") {
      data = { title: "", content: "" };
    } else if (type === "video") {
      data = { title: "", videoUrl: "" };
    } else {
      // For Question and Project, start null to trigger the selector
      data = null; 
    }

    const newItem: ContentItem = {
      id: Date.now().toString(),
      type,
      data,
    };
    setContentItems((prev) => [...prev, newItem]);
  };

  const updateContentItem = (id: string, updates: Partial<ContentItem>) => {
    setContentItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const removeContentItem = (id: string) => {
    setContentItems((prev) => prev.filter((item) => item.id !== id))
  }

  const onDeleteModule = async () => {
    if (!confirm("Are you sure you want to delete this module? This action cannot be undone.")) {
      return;
    }
    
    try {
      const res = await fetchWithAuth(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/module/${moduleId}`, {
        method: "DELETE",
      });
  
      if (!res.ok) {
        const errorText = await res.text();
        alert(`Failed to delete module: ${res.status} - ${errorText}`);
        return;
      }
  
      setTimeout(() => {
        window.location.replace("/admin/modules");
      }, 0);
    } catch (error) {
      console.error("Unexpected error during delete:", error);
      alert(`Unexpected error during delete: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Helper to check if a string looks like a valid MongoDB ObjectID (24 hex chars, not all zeros)
  const isValidObjectId = (id: any): boolean => {
    if (!id) return false;
    const str = String(id);
    // Must be 24 hex chars AND not the zero ObjectID
    return /^[a-f0-9]{24}$/i.test(str) && str !== "000000000000000000000000";
  };

  // Helper to render the selection UI for Reference types
  const renderResourceSelector = (item: ContentItem, list: any[], label: string) => {
    // 1. Safety check: Ensure list is an array
    const safeList = Array.isArray(list) ? list : [];

    // 2. Find currently selected item - must have a VALID ObjectID
    const rawId = item.data?._id || item.data?.id;
    const selectedId = isValidObjectId(rawId) ? rawId : null;
    const selectedItem = selectedId 
      ? safeList.find(i => (i._id || i.id) === selectedId) || item.data 
      : null;

    // --- CASE 1: ITEM IS SELECTED ---
    if (selectedItem && (selectedItem._id || selectedItem.id)) {
      return (
        <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 shadow-sm">
          <div>
            <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <span className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wide">
                {label} Linked
              </span>
              {selectedItem.title || "Untitled Resource"}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 font-mono">
              ID: {selectedItem._id || selectedItem.id}
            </div>
            {selectedItem.difficulty && (
               <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 capitalize">
                 Difficulty: {selectedItem.difficulty}
               </div>
            )}
          </div>
          <div className="flex gap-2">
            {!previewMode && (
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => updateContentItem(item.id, { data: null })}
                className="flex items-center gap-1 border border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Change
              </Button>
            )}
          </div>
        </div>
      );
    }

    // --- CASE 2: PREVIEW MODE (Empty) ---
    if (previewMode) {
      return (
        <div className="text-gray-600 dark:text-gray-400 italic p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800">
          No {label.toLowerCase()} selected
        </div>
      );
    }

    // --- CASE 3: SELECTION MODE (Dropdown) ---
    return (
      <div className="space-y-3 p-4 border rounded-lg border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm">
        <div className="space-y-1">
          <Label className="text-gray-900 dark:text-gray-100">Select {label} to Link</Label>
          <p className="text-[0.8rem] text-gray-600 dark:text-gray-400">
            Choose an existing {label.toLowerCase()} from the library.
          </p>
        </div>
        
        <select 
          className="flex h-10 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-800 dark:[&>option]:text-gray-100"
          value=""
          onChange={(e) => {
            const selected = safeList.find(opt => (opt._id || opt.id) === e.target.value);
            if (selected) {
              updateContentItem(item.id, { data: selected });
            }
          }}
          disabled={isLoadingResources}
        >
          <option value="" disabled>Select a {label.toLowerCase()}...</option>
          
          {/* STATE 1: LOADING */}
          {isLoadingResources && <option disabled>Loading resources...</option>}
          
          {/* STATE 2: FINISHED BUT EMPTY */}
          {!isLoadingResources && safeList.length === 0 && (
            <option disabled>No {label.toLowerCase()}s found in library</option>
          )}

          {/* STATE 3: POPULATED */}
          {safeList.map((opt, index) => {
             const val = opt._id || opt.id;
             if (!val) return null; 
             return (
              <option key={`${val}-${index}`} value={val}>
                {opt.title} {opt.difficulty ? `(${opt.difficulty})` : ""}
              </option>
            )
          })}
        </select>
        
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
          Can&apos;t find it? Make sure you created the {label.toLowerCase()} first.
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Module Details */}
      <Card>
        <CardHeader>
          <div className="flex justify-between">
            <div>
              <CardTitle>Module Information</CardTitle>
              <CardDescription>Basic details about your learning module</CardDescription>
            </div>
            <Button variant="destructive" size="sm" onClick={onDeleteModule}>Delete Module</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Module Title</Label>
            <Input
              id="title"
              value={moduleTitle}
              onChange={(e) => setModuleTitle(e.target.value)}
              placeholder="Enter module title..."
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={moduleDescription}
              onChange={(e) => setModuleDescription(e.target.value)}
              placeholder="Enter module description..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Content Management */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Module Content</CardTitle>
              <CardDescription>Structure your curriculum</CardDescription>
            </div>
            <Button
              size="sm"
              variant={previewMode ? "secondary" : "outline"}
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-2 border border-gray-300 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {previewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {previewMode ? "Edit Order" : "Preview"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!previewMode && (
            <div className="flex gap-2 mb-6 flex-wrap">
              <Button
                variant="outline"
                onClick={() => addContentItem("text")}
                className="flex items-center gap-2 border border-gray-300 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                <Plus className="h-4 w-4" /> Text
              </Button>
              <Button
                variant="outline"
                onClick={() => addContentItem("video")}
                className="flex items-center gap-2 border border-gray-300 bg-gray-50 text-gray-900 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                <Plus className="h-4 w-4" /> Video
              </Button>
              <div className="w-px h-8 bg-gray-200 mx-2 self-center hidden sm:block"></div>
              <Button onClick={() => addContentItem("question")} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700">
                <Plus className="h-4 w-4" /> Question
              </Button>
              <Button onClick={() => addContentItem("project")} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Plus className="h-4 w-4" /> Project
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {(contentItems?.length ?? 0) === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-xl text-gray-400 bg-gray-50/50">
                No content added yet. Use the buttons above to build your module.
              </div>
            ) : (
              contentItems.map((item, index) => (
                <Card
                  key={item.id}
                  className={`relative transition-all duration-200 ${
                    draggedItem === item.id ? "opacity-50 scale-95" : ""
                  } ${dragOverItem === item.id ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                  draggable={!previewMode}
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, item.id)}
                >
                  <CardHeader className="pb-3 bg-gray-50/40 border-b">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        {!previewMode && (
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => moveItem(index, "up")}
                              disabled={index === 0}
                              className="h-5 w-5 hover:bg-gray-200"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => moveItem(index, "down")}
                              disabled={index === contentItems.length - 1}
                              className="h-5 w-5 hover:bg-gray-200"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        <div className={`flex items-center gap-2 ${!previewMode ? "cursor-move" : ""}`}>
                          {!previewMode && <GripVertical className="h-4 w-4 text-gray-400" />}
                          <span className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                            {index + 1}. {item.type}
                          </span>
                        </div>
                      </div>
                      {!previewMode && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeContentItem(item.id)}
                          className="text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    
                    {/* --- TEXT CONTENT --- */}
                    {item.type === "text" && (
                       previewMode ? (
                        <div className="prose max-w-none">
                          <CustomMarkdownView markdown={item.data.content || "_No content_"} />
                        </div>
                      ) : (
                        <ContentEditor content={item} onChange={(updates) => updateContentItem(item.id, updates)} />
                      )
                    )}

                    {/* --- VIDEO CONTENT --- */}
                    {item.type === "video" && (
                      <div className="space-y-4">
                        {!previewMode && (
                           <div className="grid gap-4 p-4 bg-gray-50 rounded-lg border">
                              <div className="space-y-2">
                                <Label className="text-gray-900 dark:text-gray-100">Video Title</Label>
                                <Input
                                  className="text-black bg-white dark:bg-gray-800 dark:text-gray-100"
                                  value={item.data.title}
                                  onChange={e => updateContentItem(item.id, { data: { ...item.data, title: e.target.value } })}
                                  placeholder="e.g., Lecture 1: Introduction"
                                />
                              </div>
                              <div className="space-y-2">
                                  <Label className="text-gray-900 dark:text-gray-100">Video Source URL</Label>
                                <Input
                                  className="text-black bg-white dark:bg-gray-800 dark:text-gray-100"
                                  value={item.data.videoUrl}
                                  onChange={e => updateContentItem(item.id, { data: { ...item.data, videoUrl: e.target.value } })}
                                  placeholder="YouTube link or S3 path..."
                                />
                              </div>
                           </div>
                        )}
                        
                        {(previewMode || item.data.videoUrl) && (
                          <div className="mt-2">
                            {item.data.videoUrl && isYouTubeUrl(item.data.videoUrl) ? (
                              <div className="relative pt-[56.25%] bg-black rounded-lg overflow-hidden">
                                <iframe
                                  src={getYouTubeEmbedUrl(item.data.videoUrl)}
                                  className="absolute top-0 left-0 w-full h-full"
                                  allowFullScreen
                                />
                              </div>
                            ) : item.data.videoUrl ? (
                              <video controls className="w-full rounded-lg bg-black aspect-video">
                                <source src={getVideoUrl(item.data.videoUrl)} type="video/mp4" />
                              </video>
                            ) : previewMode && (
                              <div className="text-gray-400 text-center py-8 bg-gray-50 rounded">No video URL set</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* --- QUESTION CONTENT (REFERENCE) --- */}
                    {item.type === "question" && (
                      renderResourceSelector(item, availableQuestions, "Question")
                    )}

                    {/* --- PROJECT CONTENT (REFERENCE) --- */}
                    {item.type === "project" && (
                      renderResourceSelector(item, availableProjects, "Project")
                    )}

                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4 sticky bottom-6">
        <div className="bg-gray-50/80 backdrop-blur p-2 rounded-lg shadow-lg border flex gap-4">
          <Button asChild variant="ghost">
            <a href="/admin/modules">Cancel</a>
          </Button>
          <Button
            type="button"
            onClick={handleSaveModule}
            disabled={!moduleTitle.trim() || isSaving}
            className="min-w-[150px]"
          >
            {isSaving ? "Saving..." : mode === "edit" ? "Update Module" : "Create Module"}
          </Button>
        </div>
      </div>
    </div>
  )
}