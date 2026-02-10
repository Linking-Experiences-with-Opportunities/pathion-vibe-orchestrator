import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// ---------------------------------------------------------------------------
// Opus 4.6 System Prompt — Program State Explainer & Diagram Annotator
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a deterministic program-state explainer embedded inside a developer debugging environment.

You DO NOT execute code.
You DO NOT invent program state.
You DO NOT repair broken data structures.

Your job is to EXPLAIN and ANNOTATE what already happened.

PRIORITY RULES:
1. Runtime facts override static intent. Execution summaries are authoritative.
2. Do not assume correctness. If invariants are violated, explain the violation. Never "fix" the structure mentally.
3. Identify ONE root cause — the FIRST invariant violation or causal error. Do not list cascading symptoms unless explicitly requested.
4. No hallucinated structure. If a diagram is provided, you may annotate or highlight ONLY. You may NOT add nodes, edges, or pointers.

RESPONSIBILITIES:
1. Explain what went wrong (if anything). Identify the first causal action, explain it in plain language, reference exact lines if provided. If nothing went wrong, briefly confirm correctness.
2. Connect runtime behavior to code intent. If AST insights are provided, use them ONLY to explain why the code allowed the failure. Never restate the full AST.
3. Annotate visualizations (if present). If mermaidText is provided, you may suggest node highlights, edge highlights, or warning labels. You may NOT add missing edges, invent nodes, or redraw the structure. If no visualization is present, explain in text only.
4. Cite exact code ranges when possible. Include cited line ranges. Never guess line numbers.

PROHIBITIONS:
- Do NOT invent missing runtime steps
- Do NOT "clean up" corrupted data structures
- Do NOT infer pointer values not in evidence
- Do NOT output Mermaid code unless explicitly requested
- Do NOT restate large code blocks
- Do NOT provide generic debugging advice

OUTPUT FORMAT:
Return a JSON object with these fields (omit any that are not applicable):
{
  "summary": "One-sentence summary of what happened",
  "rootCause": "The first causal error or invariant violation",
  "explanation": "2-4 sentence technical explanation connecting code to runtime behavior",
  "diagramAnnotations": [
    {
      "target": "node | edge | global",
      "id": "optional node/edge id",
      "style": "highlight | warning",
      "message": "annotation text"
    }
  ],
  "citedLineRanges": [
    { "startLine": 0, "endLine": 0 }
  ]
}

Return ONLY valid JSON. No markdown. No backticks. No explanation outside the JSON.

TONE: Precise, calm, technical. Cause-then-effect. No emojis. No fluff. No speculation.`;

// ---------------------------------------------------------------------------
// Request Body Type
// ---------------------------------------------------------------------------
export interface AIExplainRequestBody {
  event: {
    eventType: "RUN" | "SUBMIT";
    language: string;
    contentType: "project" | "problem" | "module_problem";
  };
  code: {
    text: string;
    sha256?: string;
  };
  executionSummary: {
    universalErrorCode?: string | null;
    errorLog?: string | null;
    stdout?: string | null;
    runtimeMs?: number | null;
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
    }>;
  };
  visualization?: {
    kind?: "MERMAID" | null;
    mermaidText?: string | null;
  } | null;
  // Future: shadowrunnerSummary, astInsights
  shadowrunnerSummary?: unknown | null;
  astInsights?: unknown | null;
  request: {
    goal: "explain" | "annotate" | "diagnose";
    maxDiagramAnnotations?: number;
  };
}

// ---------------------------------------------------------------------------
// Response Type
// ---------------------------------------------------------------------------
export interface AIExplainResponse {
  summary?: string;
  rootCause?: string;
  explanation?: string;
  diagramAnnotations?: Array<{
    target: "node" | "edge" | "global";
    id?: string;
    style: "highlight" | "warning";
    message: string;
  }>;
  citedLineRanges?: Array<{
    startLine: number;
    endLine: number;
  }>;
}

// ---------------------------------------------------------------------------
// Handler
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

    const body: AIExplainRequestBody = await request.json();

    if (!body.code?.text) {
      return NextResponse.json(
        { error: "code.text is required" },
        { status: 400 }
      );
    }

    console.log("[ai-explain] Received request:", {
      eventType: body.event?.eventType,
      contentType: body.event?.contentType,
      codeLength: body.code.text.length,
      hasViz: !!body.visualization?.mermaidText,
      goal: body.request?.goal,
    });

    const ai = new GoogleGenAI({ apiKey });

    // Build the user prompt from the structured payload
    const sections: string[] = [];

    sections.push("DECISION TRACE EVENT PAYLOAD:");
    sections.push("");

    // Event metadata
    sections.push(`Event type: ${body.event?.eventType || "UNKNOWN"}`);
    sections.push(`Language: ${body.event?.language || "python"}`);
    sections.push(`Content type: ${body.event?.contentType || "unknown"}`);
    sections.push("");

    // Execution summary
    sections.push("EXECUTION SUMMARY:");
    if (body.executionSummary?.universalErrorCode) {
      sections.push(`Error code: ${body.executionSummary.universalErrorCode}`);
    }
    if (body.executionSummary?.errorLog) {
      sections.push(`Error log: ${body.executionSummary.errorLog}`);
    }
    if (body.executionSummary?.stdout) {
      sections.push(`Stdout (truncated): ${body.executionSummary.stdout.slice(0, 2000)}`);
    }
    if (body.executionSummary?.tests) {
      const t = body.executionSummary.tests;
      sections.push(`Tests: ${t.passed ?? 0}/${t.total ?? 0} passed, ${t.failed ?? 0} failed`);
    }
    if (body.executionSummary?.testResults?.length) {
      const failed = body.executionSummary.testResults.filter(
        (tr) => tr.status !== "passed"
      );
      if (failed.length > 0) {
        sections.push("Failed tests:");
        failed.slice(0, 5).forEach((tr) => {
          sections.push(`  - ${tr.testName}: ${tr.status}${tr.message ? ` — ${tr.message}` : ""}${tr.errorCode ? ` [${tr.errorCode}]` : ""}`);
        });
      }
    }
    sections.push("");

    // Visualization
    if (body.visualization?.mermaidText) {
      sections.push("VISUALIZATION (Mermaid diagram already generated):");
      sections.push(body.visualization.mermaidText);
      sections.push("");
    }

    // Shadowrunner (future)
    if (body.shadowrunnerSummary) {
      sections.push("SHADOWRUNNER SUMMARY:");
      sections.push(JSON.stringify(body.shadowrunnerSummary, null, 2));
      sections.push("");
    }

    // AST insights (future)
    if (body.astInsights) {
      sections.push("AST INSIGHTS:");
      sections.push(JSON.stringify(body.astInsights, null, 2));
      sections.push("");
    }

    // Code
    sections.push("USER CODE:");
    sections.push("```" + (body.event?.language || "python"));
    sections.push(body.code.text);
    sections.push("```");
    sections.push("");

    // Request
    sections.push(`GOAL: ${body.request?.goal || "diagnose"}`);
    if (body.request?.maxDiagramAnnotations) {
      sections.push(`Max diagram annotations: ${body.request.maxDiagramAnnotations}`);
    }

    const userPrompt = sections.join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 1.0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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

    // Parse the JSON response from Gemini
    let parsed: AIExplainResponse;
    try {
      let cleaned = text.trim();
      // Strip markdown fences if present
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn("[ai-explain] Failed to parse JSON, returning raw text as summary");
      parsed = { summary: text.slice(0, 500), explanation: text };
    }

    console.log("[ai-explain] Success:", {
      hasSummary: !!parsed.summary,
      hasRootCause: !!parsed.rootCause,
      annotationCount: parsed.diagramAnnotations?.length ?? 0,
    });

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[ai-explain] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI explain failed" },
      { status: 500 }
    );
  }
}
