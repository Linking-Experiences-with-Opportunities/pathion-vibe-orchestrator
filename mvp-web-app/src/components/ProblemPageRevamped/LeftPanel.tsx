"use client"

import type React from "react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import CustomMarkdownView from "@/components/CodeEditor/CustomMarkdownView";
import { QuestionData } from '../CodeEditor/types';
import SubmissionsTab from "./SubmissionsTab"
import { Submission } from "./models";


interface LeftPanelProps {
    problemData: QuestionData | null    
    splitPosition: number
    activeLeftTab: string
    submissions: Submission[]
}

export default function LeftPanel({
    splitPosition,
    activeLeftTab,
    problemData,
    submissions,
}: LeftPanelProps) {
    return (
        <div
            className="flex flex-col min-w-0 h-full overflow-hidden"
            style={{ width: `${splitPosition}%` }}
        >
            <Tabs value={activeLeftTab} className="w-full h-full min-h-0 flex flex-col">
              <TabsContent value="prompt" className="m-0 flex-1 min-h-0 overflow-auto scrollbar-thin scrollbar-track scrollbar-thumb">
                <div className="px-10 mt-5">
                    <CustomMarkdownView markdown={problemData?.description ?? "empty problem data"}/>
                </div>
              </TabsContent>
              <TabsContent value="scratchpad" className="m-0 flex-1 min-h-0 overflow-hidden flex flex-col data-[state=inactive]:hidden">
                <div className="p-6 flex-1 min-h-0 flex flex-col">
                  <textarea
                      className="flex-1 min-h-0 w-full bg-[#1e2d3d] text-gray-300 p-4 font-mono text-sm border border-[#2e3d4d] rounded resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Use this scratchpad to work through the problem..."
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
                <SubmissionsTab submissions={submissions} />
              </TabsContent>
            </Tabs>
        </div>
    )
}
