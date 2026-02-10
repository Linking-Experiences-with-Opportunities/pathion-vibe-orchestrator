import { RunResponse } from "./runner-contract";
import { fetchWithAuth } from "./fetchWithAuth";
import { API_ORIGIN, isApiConfigured } from "./apiConfig";
import { EditorSignals } from "./editorSignals";
import { VizPayloadV1 } from "./vizPayload";
import { getLastPyodideInitMs } from "./pyodideRunner";

export interface SubmissionPayload {
  problemId: string;
  userId: string; // Should be Supabase UUID, not email
  email?: string; // User's email address (normalized)
  language: "python";
  sourceType: "code" | "project";
  files?: Record<string, string>; // For project submissions
  userTestsCode?: string; // User-written test code
  userTestsResults?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'error';
    error: string | null;
  }>;
  result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    testSummary?: {
      total: number;
      passed: number;
      failed: number;
      cases: Array<{
        id?: string;
        fn: string;
        passed: boolean;
        received?: any;
        expected?: any;
        durationMs: number;
        error?: string;
      }>;
    };
    durationMs?: number;
    ttfrMs?: number;
  };
  meta: {
    pyodideVersion: string;
    pyodideInitMs?: number;
    timedOut?: boolean;
    memExceeded?: boolean;
    sandboxBootMs?: number;
    fallback_used?: boolean;
    fallback_reason?: string;
    /** Editor signals for copy/paste tracking */
    editorSignals?: EditorSignals;
    /** Visualization payload for debugging */
    vizPayload?: VizPayloadV1;
  };
}

export async function submitSubmission(
  problemId: string,
  userId: string, // Should be Supabase UUID
  code: string,
  runResult: RunResponse,
  sourceType: "code" | "project" = "code",
  files?: Record<string, string>,
  userTestsCode?: string,
  userTestsResults?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'error';
    error: string | null;
  }>,
  editorSignals?: EditorSignals,
  email?: string, // User's email address
  vizPayload?: VizPayloadV1
): Promise<{ success: boolean; submissionId?: string; error?: string }> {
  if (!isApiConfigured()) {
    console.error("API origin not configured");
    return { success: false, error: "API base URL not configured" };
  }

  const pyodideInitMs = getLastPyodideInitMs();
  const payload: SubmissionPayload = {
    problemId,
    userId,
    email: email?.toLowerCase().trim(), // Normalize email
    language: "python",
    sourceType,
    files: sourceType === "project" ? files : undefined,
    userTestsCode: userTestsCode || undefined,
    userTestsResults: userTestsResults || undefined,
    result: {
      exitCode: runResult.exitCode,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      testSummary: runResult.testSummary,
      durationMs: runResult.durationMs,
      ttfrMs: runResult.ttfrMs,
    },
    meta: {
      pyodideVersion: "0.28.2",
      pyodideInitMs: pyodideInitMs ?? undefined,
      timedOut: runResult.reason === "TIMEOUT",
      memExceeded: runResult.reason === "MEMORY",
      sandboxBootMs: runResult.meta?.sandboxBootMs,
      fallback_used: runResult.meta?.fallback_used,
      fallback_reason: runResult.meta?.fallback_reason,
      editorSignals: editorSignals,
      vizPayload: vizPayload,
    },
  };

  try {
    // Use relative path - fetchWithAuth will prepend API_ORIGIN for Go backend routes
    console.log('[submitSubmission] Posting to:', `${API_ORIGIN}/submissions`);
    console.log('[submitSubmission] Payload:', { ...payload, result: '...' }); // Don't log full result

    const response = await fetchWithAuth("/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log('[submitSubmission] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[submitSubmission] Submission failed:", response.status, errorText);
      return { success: false, error: `Submission failed: ${response.statusText}` };
    }

    const data = await response.json();
    console.log('[submitSubmission] Success! Submission ID:', data.submissionId || data.id);
    return { success: true, submissionId: data.submissionId || data.id };
  } catch (error) {
    console.error("[submitSubmission] Failed to submit:", error);
    return { success: false, error: error instanceof Error ? error.message : "Network error" };
  }
}





