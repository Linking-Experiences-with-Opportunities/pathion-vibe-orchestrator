/**
 * verificationAgentClient.ts
 *
 * Client helper to call the /api/verification-agent Next.js API route.
 * Follows the same pattern as callAIExplain in decisionTraceClient.ts.
 */

import type {
  SessionSummary,
  VerificationAgentResponse,
} from "./verificationAgent";
import type { VerificationAgentRequestBody } from "@/app/api/verification-agent/route";

/**
 * Call the Verification Agent API route.
 *
 * @param payload - Code, AST dump, metrics, and failed test context.
 * @returns       - ReportCard + CognitiveShadow frames.
 */
export async function callVerificationAgent(
  payload: VerificationAgentRequestBody
): Promise<VerificationAgentResponse> {
  // [verification-agent] Step 4a: client sending payload (metrics = David's SessionSummary when wired)
  console.log("[verification-agent] Step 4a: client sending payload", {
    codeLength: payload.code?.length ?? 0,
    astDumpLength: payload.astDump?.length ?? 0,
    metrics: payload.metrics
      ? {
          thrash_score: payload.metrics.thrash_score.toFixed(2),
          convergence_rate: payload.metrics.convergence_rate.toFixed(2),
          active_seconds_to_pass:
            payload.metrics.active_seconds_to_pass === Infinity
              ? "Infinity"
              : `${payload.metrics.active_seconds_to_pass.toFixed(1)}s`,
        }
      : null,
    failedTestsCount: payload.failedTests?.length ?? 0,
    hasVizSnapshot: !!payload.vizSnapshot,
  });

  const response = await fetch("/api/verification-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      "[verificationAgent] /api/verification-agent returned",
      response.status,
      errText
    );
    throw new Error(`Verification agent failed: ${response.status} ${errText}`);
  }

  const data: VerificationAgentResponse = await response.json();
  // [verification-agent] Step 4b: client received response
  console.log("[verification-agent] Step 4b: client received response", {
    diagnosisLength: data.reportCard?.diagnosis?.length ?? 0,
    challengeLength: data.reportCard?.verificationChallenge?.length ?? 0,
    shadowFrames: data.cognitiveShadow?.length ?? 0,
  });

  return data;
}
