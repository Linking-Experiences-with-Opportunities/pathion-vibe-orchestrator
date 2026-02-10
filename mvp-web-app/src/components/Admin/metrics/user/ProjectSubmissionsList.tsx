import type React from "react"
import {
  CheckCircle,
  XCircle,
  Code,
  Clock,
  ChevronDown,
  ChevronUp,
  TestTube
} from "lucide-react"
import { ProjectSubmission } from "@/components/ProjectPageRevamped/models"
import { Badge } from "@/components/ui/badge"
import { useState } from "react"

interface ProjectSubmissionsListProps {
  submissions: ProjectSubmission[]
  loading?: boolean
}

export default function ProjectSubmissionsList({
  submissions,
  loading = false
}: ProjectSubmissionsListProps) {
  const [expandedSubmissions, setExpandedSubmissions] = useState<Set<string>>(new Set())

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString() + " " + date.toLocaleTimeString()
  }

  const getLanguageDisplay = (language: string) => {
    return language.charAt(0).toUpperCase() + language.slice(1)
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return "N/A"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const toggleExpanded = (submissionId: string) => {
    setExpandedSubmissions((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(submissionId)) {
        newSet.delete(submissionId)
      } else {
        newSet.add(submissionId)
      }
      return newSet
    })
  }

  if (loading) {
    return (
      <div className="text-center py-8 text-slate-400">
        Loading submissions...
      </div>
    )
  }

  if (submissions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        No submissions yet for this project.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {submissions.map((submission) => {
        const isExpanded = expandedSubmissions.has(submission._id)

        return (
          <div
            key={submission._id}
            className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden"
          >
            {/* Submission Header - Always Visible */}
            <div
              className="p-4 cursor-pointer hover:bg-slate-800 transition-colors"
              onClick={() => toggleExpanded(submission._id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {submission.passed ? (
                    <CheckCircle className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-100">
                        {submission.passed ? "All Tests Passed" : "Some Tests Failed"}
                      </span>
                      {submission.result?.testSummary && (
                        <Badge
                          variant={submission.passed ? "default" : "destructive"}
                          className={
                            submission.passed
                              ? "bg-emerald-900 text-emerald-200 border-emerald-700"
                              : "bg-red-900 text-red-200 border-red-700"
                          }
                        >
                          {submission.result.testSummary.passed}/
                          {submission.result.testSummary.total} tests
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-slate-400 mt-1">
                      {formatDate(submission.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center space-x-4 text-sm text-slate-300">
                    <div className="flex items-center space-x-2">
                      <Code className="h-4 w-4 text-slate-400" />
                      <span>{getLanguageDisplay(submission.language)}</span>
                    </div>
                    {submission.result?.durationMs && (
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-slate-400" />
                        <span>{formatDuration(submission.result.durationMs)}</span>
                      </div>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                  )}
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="border-t border-slate-700 bg-slate-900/50">
                {/* Test Results */}
                {submission.result?.testSummary?.cases && submission.result.testSummary.cases.length > 0 && (
                  <div className="p-4 border-b border-slate-700">
                    <div className="text-sm font-medium text-slate-200 mb-3">
                      Test Results
                    </div>
                    <div className="space-y-2 max-h-60 overflow-auto">
                      {submission.result.testSummary.cases.map((testCase, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${
                            testCase.passed
                              ? "bg-emerald-950/30 border-emerald-900/50"
                              : "bg-red-950/30 border-red-900/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {testCase.passed ? (
                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="font-mono text-sm text-slate-200">
                                {testCase.fn}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400">
                              {formatDuration(testCase.durationMs)}
                            </span>
                          </div>
                          {testCase.error && (
                            <div className="mt-2 text-xs text-red-300 font-mono bg-red-950/30 p-2 rounded">
                              {testCase.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* User Tests */}
                {(submission.userTestsCode || (submission.userTestsResults && submission.userTestsResults.length > 0)) && (
                  <div className="p-4 border-b border-slate-700">
                    <div className="text-sm font-medium text-slate-200 mb-3 flex items-center gap-2">
                      <TestTube className="h-4 w-4 text-blue-400" />
                      <span>User-Written Tests</span>
                    </div>
                    
                    {/* User Test Results */}
                    {submission.userTestsResults && submission.userTestsResults.length > 0 && (
                      <div className="space-y-2 mb-3 max-h-60 overflow-auto">
                        {submission.userTestsResults.map((userTest, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              userTest.status === 'pass'
                                ? "bg-emerald-950/30 border-emerald-900/50"
                                : "bg-red-950/30 border-red-900/50"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {userTest.status === 'pass' ? (
                                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                )}
                                <span className="font-mono text-sm text-slate-200">
                                  {userTest.name}
                                </span>
                                <Badge
                                  variant={userTest.status === 'pass' ? "default" : "destructive"}
                                  className={
                                    userTest.status === 'pass'
                                      ? "bg-emerald-900 text-emerald-200 border-emerald-700 text-xs"
                                      : "bg-red-900 text-red-200 border-red-700 text-xs"
                                  }
                                >
                                  {userTest.status === 'pass' ? 'Passed' : userTest.status === 'fail' ? 'Failed' : 'Error'}
                                </Badge>
                              </div>
                            </div>
                            {userTest.error && (
                              <div className="mt-2 text-xs text-red-300 font-mono bg-red-950/30 p-2 rounded">
                                {userTest.error}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* User Test Code */}
                    {submission.userTestsCode && (
                      <details className=" rounded-lg border border-slate-700">
                        <summary className="px-3 py-2 cursor-pointer hover:bg-slate-900 rounded-lg text-sm font-mono text-slate-300">
                          User Test Code
                        </summary>
                        <pre className="px-3 pb-3 pt-2 text-xs overflow-auto max-h-60 font-mono text-slate-300 border-t border-slate-700">
                          {submission.userTestsCode}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Error Output */}
                {submission.result?.stderr && (
                  <div className="p-4 border-b border-slate-700">
                    <div className="text-sm font-medium text-red-400 mb-2">
                      Error Output
                    </div>
                    <pre className=" p-3 rounded-lg text-xs overflow-auto max-h-40 text-red-300 border border-red-900/50">
                      {submission.result.stderr}
                    </pre>
                  </div>
                )}

                {/* Files */}
                {submission.files && Object.keys(submission.files).length > 0 && (
                  <div className="p-4">
                    <div className="text-sm font-medium text-slate-200 mb-2">
                      Submitted Files ({Object.keys(submission.files).length})
                    </div>
                    <div className="space-y-2">
                      {Object.entries(submission.files).map(([filename, content]) => (
                        <details key={filename} className=" rounded-lg border border-slate-700">
                          <summary className="px-3 py-2 cursor-pointer hover:bg-slate-900 rounded-lg text-sm font-mono text-slate-300">
                            {filename}
                          </summary>
                          <pre className="px-3 pb-3 pt-2 text-xs overflow-auto max-h-60 font-mono text-slate-300 border-t border-slate-700">
                            {content}
                          </pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
