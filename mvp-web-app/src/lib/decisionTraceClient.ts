/**
 * decisionTraceClient.ts
 *
 * Client helpers for:
 * 1. Calling /api/ai-explain (Opus 4.6 prompt via Gemini Flash)
 * 2. Posting decision trace events to the Go backend POST /decision-trace/event
 */

import { fetchWithAuth } from "./fetchWithAuth";
import type { AIExplainRequestBody, AIExplainResponse } from "@/app/api/ai-explain/route";
import type { TestResult } from "@/components/ProblemPageRevamped/models";
import type { VizPayloadV1, StateSnapshot } from "./vizPayload";
import type { ProjectData } from "@/components/CodeEditor/types";

// ---------------------------------------------------------------------------
// 1. AI Explain — calls Next.js /api/ai-explain
// ---------------------------------------------------------------------------

export async function callAIExplain(
  payload: AIExplainRequestBody
): Promise<AIExplainResponse> {
  console.log("[decisionTrace] Step 1: Calling /api/ai-explain");

  const response = await fetch("/api/ai-explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[decisionTrace] Step 1 FAILED: /api/ai-explain returned", response.status, errText);
    throw new Error(`AI explain failed: ${response.status} ${errText}`);
  }

  const data: AIExplainResponse = await response.json();
  console.log("[decisionTrace] Step 1 OK: AI explain returned", {
    hasSummary: !!data.summary,
    hasRootCause: !!data.rootCause,
    annotationCount: data.diagramAnnotations?.length ?? 0,
  });

  return data;
}

// ---------------------------------------------------------------------------
// 2. Post Decision Trace Event — calls Go backend POST /decision-trace/event
// ---------------------------------------------------------------------------

/** Maps to DTEventPayload in handlers/decision_trace.go */
interface DTEventPayload {
  contentId: string;
  contentType: "project" | "problem" | "module_problem";
  language: string;
  eventType: "RUN" | "SUBMIT";
  codeText: string;
  browserSubmissionId?: string;
  execution?: {
    universalErrorCode?: string | null;
    errorLog?: string | null;
    stdout?: string | null;
    runtimeMs?: number | null;
    memoryKb?: number | null;
    tests?: {
      total?: number | null;
      passed?: number | null;
      failed?: number | null;
    };
    testResults?: Array<{
      testName: string;
      status: string;
      message?: string | null;
      errorCode?: string | null;
      errorTooltip?: string | null;
    }>;
  };
  visualization?: {
    kind: 'MERMAID' | null;
    mermaidText?: string;
    stateSnapshot?: Record<string, any>;
  };
  stats?: {
    syntaxFailures: number;
    syntaxFixTimeMs: number;
    mentalModelMatches: number;
    mentalModelMismatches: number;
  };
  ai?: {
    nano?: {
      enabled: boolean;
      promptVersion?: string | null;
      summary?: string | null;
    };
    gemini?: {
      enabled: boolean;
      model?: string | null;
      promptVersion?: string | null;
      nudgeType?: string | null;
      responseText?: string | null;
      citedLineRanges?: Array<{
        file?: string | null;
        startLine: number;
        endLine: number;
      }>;
    };
  };
}

export async function postDecisionTraceEvent(
  payload: DTEventPayload
): Promise<{ eventId: string; sessionId: string }> {
  console.log("[decisionTrace] Step 2: Posting to /decision-trace/event");

  const response = await fetchWithAuth("/decision-trace/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[decisionTrace] Step 2 FAILED: /decision-trace/event returned", response.status, errText);
    throw new Error(`Decision trace event failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  console.log("[decisionTrace] Step 2 OK: eventId=%s sessionId=%s", data.eventId, data.sessionId);

  return { eventId: data.eventId, sessionId: data.sessionId };
}

// ---------------------------------------------------------------------------
// 3. GET Decision Trace Session / Timeline / Event (for RetrospectiveView)
// ---------------------------------------------------------------------------

/** Response from GET /decision-trace/session. Backend: backend_api_contract.md */
export interface DecisionTraceSessionResponse {
  session: {
    _id: string;
    userId: string;
    contentId: string;
    contentType: string;
    language: string;
    status: string;
    startedAt: string;
    endedAt?: string | null;
    lastEventAt: string;
    lastEventId?: string | null;
    totalEvents: number;
    lastBrowserSubmissionId?: string | null;
  } | null;
}

/** Response from GET /decision-trace/timeline. Backend: backend_api_contract.md */
export interface DecisionTraceTimelineEntryResponse {
  eventId: string;
  createdAt: string;
  eventType: "RUN" | "SUBMIT";
  testsFailed?: number | null;
  universalErrorCode?: string | null;
}

export interface DecisionTraceTimelineResponse {
  sessionId: string;
  events: DecisionTraceTimelineEntryResponse[];
}

/** Response from GET /decision-trace/event. Backend: backend_api_contract.md */
export interface DecisionTraceEventResponse {
  event: {
    _id: string;
    sessionId: string;
    userId: string;
    contentId: string;
    contentType: string;
    language: string;
    eventType: "RUN" | "SUBMIT";
    createdAt: string;
    browserSubmissionId?: string | null;
    code: { text: string; sha256: string };
    execution: {
      universalErrorCode?: string | null;
      errorLog?: string | null;
      stdout?: string | null;
      runtimeMs?: number | null;
      memoryKb?: number | null;
      tests?: { total?: number | null; passed?: number | null; failed?: number | null };
      testResults?: Array<{
        testName: string;
        status: string;
        message?: string | null;
        errorCode?: string | null;
        errorTooltip?: string | null;
      }>;
    };
    visualization?: {
      kind?: string | null;
      mermaidText?: string | null;
      stateSnapshot?: Record<string, unknown> | null;
    };
    ai?: {
      nano?: { enabled: boolean; promptVersion?: string | null; summary?: string | null };
      gemini?: {
        enabled: boolean;
        model?: string | null;
        promptVersion?: string | null;
        nudgeType?: string | null;
        responseText?: string | null;
        citedLineRanges?: Array<{ file?: string | null; startLine: number; endLine: number }>;
      };
    };
  };
}

/**
 * Get active decision-trace session for user + content.
 * GET /decision-trace/session?contentId=<id>&contentType=<type>
 * Auth: required (JWT).
 */
export async function getDecisionTraceSession(
  contentId: string,
  contentType: "project" | "problem" | "module_problem"
): Promise<DecisionTraceSessionResponse> {
  const params = new URLSearchParams({ contentId, contentType });
  const response = await fetchWithAuth(`/decision-trace/session?${params}`);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Decision trace session failed: ${response.status} ${errText}`);
  }
  return response.json();
}

/**
 * Get timeline entries for a session.
 * GET /decision-trace/timeline?sessionId=<id>
 * Auth: required (JWT).
 */
export async function getDecisionTraceTimeline(
  sessionId: string
): Promise<DecisionTraceTimelineResponse> {
  const response = await fetchWithAuth(`/decision-trace/timeline?sessionId=${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Decision trace timeline failed: ${response.status} ${errText}`);
  }
  return response.json();
}

/**
 * Get full event document for scrub/detail view.
 * GET /decision-trace/event?id=<eventId>
 * Auth: required (JWT).
 */
export async function getDecisionTraceEvent(
  eventId: string
): Promise<DecisionTraceEventResponse> {
  const response = await fetchWithAuth(`/decision-trace/event?id=${encodeURIComponent(eventId)}`);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Decision trace event failed: ${response.status} ${errText}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// 4. Orchestrator — combines AI explain + DT event in one fire-and-forget call
// ---------------------------------------------------------------------------

export interface FireDecisionTraceParams {
  eventType: "RUN" | "SUBMIT";
  contentType: "project" | "problem" | "module_problem";
  contentId: string;
  language?: string;
  /** Concatenated code (for projects: all files joined, or main file) */
  codeText: string;
  /** Test results from the run/submit */
  testResults: TestResult[];
  /** Console output / stdout */
  consoleOutput?: string;
  /** Viz payload from the worker (if any) */
  vizPayload?: VizPayloadV1 | null;
  /** AI-generated Mermaid source (from vizPayloadToMermaidSource) */
  mermaidSource?: string | null;
  /** Session stats (syntax/mental model) */
  stats?: {
    syntaxFailures: number;
    syntaxFixTimeMs: number;
    mentalModelMatches: number;
    mentalModelMismatches: number;
  };
}

/**
 * Fire-and-forget: calls AI explain, then posts the decision trace event.
 * Never throws — errors are caught and logged.
 */
export async function fireDecisionTraceEvent(
  params: FireDecisionTraceParams
): Promise<void> {
  const {
    eventType,
    contentType,
    contentId,
    language = "python",
    codeText,
    testResults,
    consoleOutput,
    vizPayload,
    mermaidSource,
    stats,
  } = params;

  console.log("[decisionTrace] fireDecisionTraceEvent:", {
    eventType,
    contentType,
    contentId,
    codeLength: codeText.length,
    testCount: testResults.length,
    hasMermaid: !!mermaidSource,
  });

  // Build execution summary from test results
  const passed = testResults.filter((t) => t.passed).length;
  const failed = testResults.filter((t) => !t.passed).length;
  const total = testResults.length;

  // Find first failed test for error context
  const firstFailed = testResults.find((t) => !t.passed);

  // Step 1: Call AI explain (only if there are failures to diagnose)
  let aiResponse: AIExplainResponse | null = null;
  if (failed > 0) {
    try {
      const explainPayload: AIExplainRequestBody = {
        event: { eventType, language, contentType },
        code: { text: codeText },
        executionSummary: {
          universalErrorCode: firstFailed?.errorCode ?? null,
          errorLog: firstFailed?.printed ?? null,
          stdout: consoleOutput ?? null,
          tests: { total, passed, failed },
          testResults: testResults.slice(0, 10).map((t) => ({
            testName: t.name,
            status: t.passed ? "passed" : "failed",
            message: t.printed ?? null,
            errorCode: t.errorCode ?? null,
          })),
        },
        visualization: mermaidSource
          ? { kind: "MERMAID", mermaidText: mermaidSource }
          : null,
        request: { goal: "diagnose", maxDiagramAnnotations: 3 },
      };

      aiResponse = await callAIExplain(explainPayload);
    } catch (e) {
      console.error("[decisionTrace] AI explain failed (non-blocking):", e);
      // Continue without AI — we still want to record the DT event
    }
  } else {
    console.log("[decisionTrace] All tests passed — skipping AI explain");
  }

  // Step 2: Post the decision trace event to the Go backend
  try {
    const dtPayload: DTEventPayload = {
      contentId,
      contentType,
      language,
      eventType,
      codeText,
      execution: {
        universalErrorCode: firstFailed?.errorCode ?? undefined,
        errorLog: firstFailed?.printed ?? undefined,
        stdout: consoleOutput ?? undefined,
        tests: { total, passed, failed },
        testResults: testResults.slice(0, 10).map((t) => ({
          testName: t.name,
          status: t.passed ? "passed" : "failed",
          message: t.printed ?? undefined,
          errorCode: t.errorCode ?? undefined,
          errorTooltip: t.errorTooltip ?? undefined,
        })),
      },
      visualization: mermaidSource || vizPayload?.viz?.stateSnapshot
        ? {
          kind: mermaidSource ? "MERMAID" : null,
          mermaidText: mermaidSource ?? undefined,
          stateSnapshot: vizPayload?.viz?.stateSnapshot ?? undefined,
        }
        : undefined,
      stats: stats,
      ai: {
        nano: { enabled: false },
        gemini: aiResponse
          ? {
            enabled: true,
            model: "gemini-3-flash-preview",
            promptVersion: "opus-4.6-v1",
            nudgeType: "diagnose",
            responseText: aiResponse.explanation ?? aiResponse.summary ?? null,
            citedLineRanges: aiResponse.citedLineRanges?.map((r) => ({
              startLine: r.startLine,
              endLine: r.endLine,
            })) ?? [],
          }
          : { enabled: false },
      },
    };

    const result = await postDecisionTraceEvent(dtPayload);
    console.log("[decisionTrace] Complete: eventId=%s sessionId=%s", result.eventId, result.sessionId);
  } catch (e) {
    console.error("[decisionTrace] DT event post failed (non-blocking):", e);
  }
}
