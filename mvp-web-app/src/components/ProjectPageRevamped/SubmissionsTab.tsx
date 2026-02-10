import type React from "react"
import {
  CheckCircle,
  XCircle,
  Code,
  FileText,
  Clock,
  TestTube,
} from "lucide-react"
import { ProjectSubmission } from "./models";
import { Badge } from "@/components/ui/badge";
import { VizPayloadV1 } from "@/lib/vizPayload";
import { FEATURE_MERMAID_DEBUGGER } from "@/lib/flags";
import { Button } from "@/components/ui/button";

import { trackTelemetry } from "@/lib/telemetryClient";

interface SubmissionsTabProps {
  submissions: ProjectSubmission[]
  onVisualize?: (payload: VizPayloadV1) => void
}

export default function SubmissionsTab({submissions, onVisualize}: SubmissionsTabProps) {
    
    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleDateString() + " " + date.toLocaleTimeString()
    }

    const getLanguageDisplay = (language: string) => {
      // Capitalize first letter
      return language.charAt(0).toUpperCase() + language.slice(1)
    }

    const formatDuration = (ms?: number) => {
      if (!ms) return "N/A"
      if (ms < 1000) return `${ms}ms`
      return `${(ms / 1000).toFixed(2)}s`
    }

    return (
        <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4 px-6 pt-6">
          <h2 className="text-xl font-bold">Your Submissions</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
        {submissions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <p>You haven&apos;t submitted any solutions yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((submission) => (
              <div
                key={submission._id}
                className="p-4 rounded-md border border-[#2e3d4d] bg-[#0d1b2a] cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {submission.passed ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    <span className="font-medium">
                      {submission.passed ? "All Tests Passed" : "Some Tests Failed"}
                    </span>
                    {submission.result?.testSummary && (
                      <span className="text-sm text-gray-400">
                        ({submission.result.testSummary.passed}/{submission.result.testSummary.total} tests passed)
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400">{formatDate(submission.createdAt)}</div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center space-x-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Code className="h-4 w-4 text-gray-400" />
                      <span>{getLanguageDisplay(submission.language)}</span>
                    </div>
                    {submission.result?.durationMs && (
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-gray-400" />
                        <span>{formatDuration(submission.result.durationMs)}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Debug Button */}
                  {FEATURE_MERMAID_DEBUGGER && submission.meta?.vizPayload && submission.meta.vizPayload.vizEligible && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-purple-500/50 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onVisualize && submission.meta.vizPayload) {
                          trackTelemetry("viz_opened", {
                            testName: submission.meta.vizPayload.testName,
                            errorCode: submission.meta.vizPayload.errorCode,
                            diagramType: submission.meta.vizPayload.viz?.diagramType,
                            source: "submissions_tab"
                          });
                          onVisualize(submission.meta.vizPayload);
                        }
                      }}
                    >
                      <TestTube className="h-3 w-3 mr-1.5" />
                      Visualize Error
                    </Button>
                  )}
                </div>

                {/* Files section */}
                {submission.files && Object.keys(submission.files).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#2e3d4d]">
                    <div className="flex items-center space-x-2 text-sm text-gray-400 mb-2">
                      <FileText className="h-4 w-4" />
                      <span>Files ({Object.keys(submission.files).length}):</span>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(submission.files).map(([filename, content]) => (
                        <details key={filename} className="bg-[#0d1b2a] rounded-md">
                          <summary className="px-3 py-2 cursor-pointer hover:bg-[#1a2d42] rounded-md text-sm font-mono">
                            {filename}
                          </summary>
                          <pre className="px-3 pb-3 text-xs overflow-auto max-h-60 font-mono">
                            {content}
                          </pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                {/* Test results details */}
                {submission.result?.testSummary?.cases && submission.result.testSummary.cases.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#2e3d4d]">
                    <div className="text-sm text-gray-400 mb-2">Test Results:</div>
                    <div className="space-y-1 max-h-40 overflow-auto">
                      {submission.result.testSummary.cases.map((testCase, idx) => (
                        <div 
                          key={idx}
                          className={`text-xs p-2 rounded ${
                            testCase.passed ? "bg-green-900/20" : "bg-red-900/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono">{testCase.fn}</span>
                            <span className="text-gray-400">{formatDuration(testCase.durationMs)}</span>
                          </div>
                          {testCase.error && (
                            <div className="text-red-400 mt-1">{testCase.error}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* User-Written Tests */}
                {(submission.userTestsCode || (submission.userTestsResults && submission.userTestsResults.length > 0)) && (
                  <div className="mt-3 pt-3 border-t border-[#2e3d4d]">
                    <div className="text-sm text-gray-400 mb-2 flex items-center gap-2">
                      <TestTube className="h-4 w-4 text-blue-400" />
                      <span>Your Custom Tests</span>
                    </div>
                    
                    {/* User Test Results */}
                    {submission.userTestsResults && submission.userTestsResults.length > 0 && (
                      <div className="space-y-1 max-h-40 overflow-auto mb-2">
                        {submission.userTestsResults.map((userTest, idx) => (
                          <div
                            key={idx}
                            className={`text-xs p-2 rounded ${
                              userTest.status === 'pass'
                                ? "bg-green-900/20"
                                : "bg-red-900/20"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {userTest.status === 'pass' ? (
                                <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                              )}
                              <span className="font-mono">{userTest.name}</span>
                              <Badge
                                variant={userTest.status === 'pass' ? "default" : "destructive"}
                                className={`text-[10px] px-1.5 py-0 ${
                                  userTest.status === 'pass'
                                    ? "bg-green-900 text-green-200 border-green-700"
                                    : "bg-red-900 text-red-200 border-red-700"
                                }`}
                              >
                                {userTest.status === 'pass' ? 'Passed' : userTest.status === 'fail' ? 'Failed' : 'Error'}
                              </Badge>
                            </div>
                            {userTest.error && (
                              <div className="text-red-400 mt-1 ml-5">{userTest.error}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* User Test Code */}
                    {submission.userTestsCode && (
                      <details className="bg-[#0d1b2a] rounded-md border border-[#2e3d4d]">
                        <summary className="px-3 py-2 cursor-pointer hover:bg-[#1a2d42] rounded-md text-sm font-mono text-gray-300">
                          View Test Code
                        </summary>
                        <pre className="px-3 pb-3 pt-2 text-xs overflow-auto max-h-60 font-mono border-t border-[#2e3d4d]">
                          {submission.userTestsCode}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Execution errors */}
                {submission.result?.stderr && (
                  <div className="mt-3 pt-3 border-t border-[#2e3d4d]">
                    <div className="text-sm text-red-400 mb-2">Error Output:</div>
                    <pre className="bg-[#0d1b2a] p-3 rounded-md text-xs overflow-auto max-h-40 text-red-300">
                      {submission.result.stderr}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    )
}
