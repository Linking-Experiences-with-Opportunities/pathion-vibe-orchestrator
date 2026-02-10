"use client"

import type React from "react"
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs"
import { TabsTriggerList } from "../ProblemPageRevamped/TabsTriggerList"
import CustomMarkdownView from "@/components/CodeEditor/CustomMarkdownView";
import { ProjectData } from '../CodeEditor/types';
import SubmissionsTab from "./SubmissionsTab"
import { ProjectSubmission } from "./models";


import { VizPayloadV1 } from "@/lib/vizPayload";

interface ProjectLeftPanelProps {
  projectData: ProjectData | null
  splitPosition: number
  activeLeftTab: string
  submissions: ProjectSubmission[]
  onVisualize?: (payload: VizPayloadV1) => void
  setActiveLeftTab: (tab: string) => void
}

const tabs = ["prompt", "scratchpad", "solutions", "video", "submissions"]

export default function ProjectLeftPanel({
  splitPosition,
  activeLeftTab,
  projectData,
  submissions,
  onVisualize,
  setActiveLeftTab,
}: ProjectLeftPanelProps) {
  return (
    <div
      className="flex flex-col min-w-0 h-full overflow-hidden"
      style={{ width: `${splitPosition}%` }}
    >
      <Tabs value={activeLeftTab} onValueChange={setActiveLeftTab} className="w-full h-full min-h-0 flex flex-col">
        {/* Tabs Header - Aligned with Right Panel */}
        <div className="flex-none border-b border-[#262626] bg-[#19191c]">
          <TabsList className="bg-transparent text-slate-500 border-b-0 rounded-none h-10 w-full justify-start p-0">
            <TabsTriggerList
              tabs={tabs}
              activeTab={activeLeftTab}
              onChange={setActiveLeftTab}
            />
          </TabsList>
        </div>

        <TabsContent value="prompt" className="m-0 flex-1 min-h-0 overflow-auto scrollbar-thin scrollbar-track scrollbar-thumb">
          <div className="px-6 mt-2">
            {/* Project header */}
            <div className="mb-4">
              {/* Title removed to save space (already in top bar) */}
              <div className="flex gap-2">
                {/* Moved description to be more compact if needed, or keep as is */}
              </div>
              <p className="text-gray-400 text-sm">{projectData?.description}</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {projectData?.tags.map(tag => (
                  <span key={tag} className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Instructions */}
            <div className="">
              <CustomMarkdownView markdown={projectData?.instructions || ""} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="scratchpad" className="m-0 flex-1 min-h-0 overflow-hidden flex flex-col data-[state=inactive]:hidden">
          <div className="p-4 flex-1 min-h-0 flex flex-col">
            <textarea
              className="flex-1 min-h-0 w-full bg-[#1e2d3d] text-gray-300 p-4 font-mono text-sm border border-[#2e3d4d] rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Use this scratchpad to work through the project..."
            />
          </div>
        </TabsContent>
        <TabsContent value="solutions" className="m-0 flex-1 min-h-0 overflow-auto">
          <div className="p-6 text-center text-gray-400">
            <p>Solutions will be available after you submit your own solution.</p>
          </div>
        </TabsContent>
        <TabsContent value="video" className="m-0 flex-1 min-h-0 overflow-auto">
          <div className="p-6 text-center text-gray-400">
            <p>Video explanation will be available after you submit your own solution.</p>
          </div>
        </TabsContent>
        <TabsContent value="submissions" className="m-0 flex-1 min-h-0 overflow-hidden flex flex-col data-[state=inactive]:hidden">
          <SubmissionsTab submissions={submissions} onVisualize={onVisualize} />
        </TabsContent>
      </Tabs>
    </div>
  )
}


