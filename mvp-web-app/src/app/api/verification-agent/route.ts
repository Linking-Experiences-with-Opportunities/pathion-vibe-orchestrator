import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  ReportCard,
  CognitiveShadowFrame,
  SessionSummary,
  VerificationAgentResponse,
} from "@/lib/verificationAgent";

// ---------------------------------------------------------------------------
// Model Configuration
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-3-pro-preview";

// ---------------------------------------------------------------------------
// System Prompt — Senior Engineer Coach
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an autonomous Senior Engineer Coach. Your goal is to identify the user's flawed mental model based on their 'Thrash Score' and AST diffs. You DO NOT fix code. You generate a 'Verification Challenge'—a single Python assertion that will FAIL given their current logic, proving their assumption is wrong.

RULES:
1. You NEVER provide code fixes, refactors, or corrected implementations.
2. Your "diagnosis" must identify WHAT is structurally wrong (e.g., "pointer not advanced after insertion").
3. Your "mentalModelGap" must describe the flawed assumption the user appears to hold (e.g., "You seem to assume that appending a node automatically updates the tail pointer").
4. Your "verificationChallenge" must be a single Python assertion statement (e.g., "assert ll.size == ll.count_reachable(), 'stored size does not match reachable node count'") that will FAIL when executed against the user's current code, proving their assumption is wrong.
5. For the "cognitiveShadow" array, produce 1-3 frames comparing what you think the user assumes vs. what the execution state actually shows.

OUTPUT FORMAT — return ONLY valid JSON matching this schema:
{
  "reportCard": {
    "diagnosis": "<root cause of structural failure>",
    "mentalModelGap": "<the flawed assumption>",
    "verificationChallenge": "<single Python assert statement>"
  },
  "cognitiveShadow": [
    {
      "userAssumption": "<what user seems to believe>",
      "wasmReality": "<what execution state actually shows>",
      "delta": "<the mismatch>"
    }
  ]
}

Return ONLY valid JSON. No markdown. No backticks. No explanation outside the JSON.`;

// ---------------------------------------------------------------------------
// Request Body
// ---------------------------------------------------------------------------

export interface VerificationAgentRequestBody {
  /** The user's current code. */
  code: string;
  /** Simplified AST dump (FunctionDefs, If/While nodes, line numbers). */
  astDump: string;
  /** Session metrics (placeholder or real from David's layer). */
  metrics: SessionSummary;
  /** Recent failed test results for context. */
  failedTests: Array<{
    testName: string;
    status: string;
    message?: string | null;
    errorCode?: string | null;
  }>;
  /** Optional visualization state snapshot. */
  vizSnapshot?: unknown | null;
}

// ---------------------------------------------------------------------------
// POST Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body: VerificationAgentRequestBody = await request.json();

    if (!body.code) {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 }
      );
    }

    // [verification-agent] Step 5a: API received request (metrics = David's SessionSummary when wired)
    console.log("[verification-agent] Step 5a: API received request", {
      codeLength: body.code.length,
      astDumpLength: body.astDump?.length ?? 0,
      metrics: body.metrics
        ? {
          thrash_score: body.metrics.thrash_score.toFixed(2),
          convergence_rate: body.metrics.convergence_rate.toFixed(2),
          active_seconds_to_pass:
            body.metrics.active_seconds_to_pass === Infinity
              ? "Infinity"
              : `${body.metrics.active_seconds_to_pass.toFixed(1)}s`,
        }
        : null,
      failedTestsCount: body.failedTests?.length ?? 0,
      hasVizSnapshot: !!body.vizSnapshot,
    });

    // ------------------------------------------------------------------
    // Build user prompt
    // ------------------------------------------------------------------
    const sections: string[] = [];

    sections.push("SESSION METRICS (Thrash Analysis):");
    sections.push(`  thrash_score: ${body.metrics.thrash_score.toFixed(2)}`);
    sections.push(`  convergence_rate: ${body.metrics.convergence_rate.toFixed(2)}`);
    sections.push(`  active_seconds_to_pass: ${body.metrics.active_seconds_to_pass === Infinity ? "never" : body.metrics.active_seconds_to_pass.toFixed(1) + "s"}`);
    sections.push("");

    sections.push("SIMPLIFIED AST STRUCTURE:");
    sections.push(body.astDump || "(empty or unparseable)");
    sections.push("");

    if (body.failedTests && body.failedTests.length > 0) {
      sections.push("RECENT FAILED TESTS:");
      body.failedTests.slice(0, 5).forEach((t) => {
        sections.push(`  - ${t.testName}: ${t.status}${t.message ? ` — ${t.message}` : ""}${t.errorCode ? ` [${t.errorCode}]` : ""}`);
      });
      sections.push("");
    }

    if (body.vizSnapshot) {
      sections.push("VISUALIZATION STATE SNAPSHOT:");
      sections.push(JSON.stringify(body.vizSnapshot, null, 2));
      sections.push("");
    }

    sections.push("USER CODE:");
    sections.push("```python");
    sections.push(body.code);
    sections.push("```");

    const userPrompt = sections.join("\n");

    // ------------------------------------------------------------------
    // Call Gemini 3 Pro Preview with HIGH thinking
    // ------------------------------------------------------------------
    // [verification-agent] Step 5b: API calling Gemini
    console.log("[verification-agent] Step 5b: API calling Gemini", {
      model: GEMINI_MODEL,
      promptLength: userPrompt.length,
    });

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 1.0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
      },
      contents: userPrompt,
    });

    const text = response.text;

    if (!text) {
      return NextResponse.json(
        { error: "No response from model" },
        { status: 502 }
      );
    }

    // ------------------------------------------------------------------
    // Parse and validate response
    // ------------------------------------------------------------------
    let parsed: VerificationAgentResponse;
    try {
      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned
          .replace(/^```(?:json)?\s*\n?/, "")
          .replace(/\n?```\s*$/, "");
      }
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(
        "[verification-agent] Failed to parse JSON response, returning fallback"
      );
      parsed = {
        reportCard: {
          diagnosis: text.slice(0, 300),
          mentalModelGap: "Unable to parse structured response from model.",
          verificationChallenge: "assert False, 'verification agent response parse error'",
        },
        cognitiveShadow: [],
      };
    }

    // Validate required fields
    if (!parsed.reportCard) {
      parsed.reportCard = {
        diagnosis: "No diagnosis generated.",
        mentalModelGap: "No mental model gap identified.",
        verificationChallenge: "assert False, 'no challenge generated'",
      };
    }
    if (!parsed.cognitiveShadow) {
      parsed.cognitiveShadow = [];
    }

    // [verification-agent] Step 5c: API response parsed — returning to client
    console.log("[verification-agent] Step 5c: API response parsed", {
      diagnosisLength: parsed.reportCard.diagnosis.length,
      challengeLength: parsed.reportCard.verificationChallenge.length,
      shadowFrames: parsed.cognitiveShadow.length,
    });

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[verification-agent] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification agent failed" },
      { status: 500 }
    );
  }
}
