import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import {
  pickTargetMethod,
  buildGeminiPrompt,
  type ChallengeResponse,
} from "@/lib/challengeMode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Which Gemini model to use. Prefer flash for speed + cost. */
const GEMINI_MODEL = "gemini-3-flash-preview";

// ---------------------------------------------------------------------------
// Types for Gemini response parsing
// ---------------------------------------------------------------------------

interface GeminiCandidate {
  seedArray: number[];
  why: string;
}

interface GeminiChallengeOutput {
  strategy: string;
  candidate_inputs: GeminiCandidate[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Call Gemini to generate adversarial seed arrays.
 */
async function callGemini(
  prompt: string,
  apiKey: string
): Promise<GeminiChallengeOutput | null> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      config: {
        temperature: 1.0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
      contents: prompt,
    });

    const text = response.text;

    if (!text) return null;

    // Strip any markdown fences the model might add
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(cleaned) as GeminiChallengeOutput;

    // Validate shape
    if (
      !parsed.candidate_inputs ||
      !Array.isArray(parsed.candidate_inputs) ||
      parsed.candidate_inputs.length === 0
    ) {
      console.warn("[challenge] Gemini returned no candidate_inputs");
      return null;
    }

    // Sanitise: ensure all seedArrays contain only numbers
    parsed.candidate_inputs = parsed.candidate_inputs
      .filter(
        (c) => Array.isArray(c.seedArray) && c.seedArray.every((v) => typeof v === "number")
      )
      .map((c) => ({
        seedArray: c.seedArray.map((v) => Math.round(v)), // ensure ints
        why: String(c.why ?? ""),
      }));

    if (parsed.candidate_inputs.length === 0) return null;

    return parsed;
  } catch (err) {
    console.error("[challenge] Gemini call failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // 1. Parse and validate request
    // ------------------------------------------------------------------
    const body = await request.json();
    const {
      sessionId,
      projectId,
      codeSnapshot,
      language,
    }: {
      sessionId?: string;
      projectId?: string;
      codeSnapshot?: string;
      language?: string;
    } = body;

    if (!codeSnapshot) {
      return NextResponse.json(
        { error: "codeSnapshot is required" },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 2. Check API key
    // ------------------------------------------------------------------
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[challenge] No GEMINI_API_KEY set");
      const errorResponse: ChallengeResponse = {
        status: "error",
        ui: {
          headline: "Boss fight unavailable",
          hint: "AI service is not configured. Please contact support.",
          cta: "Try again later",
        },
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // ------------------------------------------------------------------
    // 3. Compute brittleness score and pick target method
    // ------------------------------------------------------------------
    const targetMethod = pickTargetMethod(codeSnapshot);
    console.log("[challenge] targetMethod:", targetMethod);

    // ------------------------------------------------------------------
    // 4. Build prompt and call Gemini
    // ------------------------------------------------------------------
    const prompt = buildGeminiPrompt(targetMethod, codeSnapshot);
    const geminiResult = await callGemini(prompt, apiKey);

    if (!geminiResult) {
      const noResult: ChallengeResponse = {
        status: "no_counterexample",
        ui: {
          headline: "Boss couldn't find a weakness!",
          hint: "The AI could not generate valid test inputs. Your code might be solid -- or try again for a tougher challenge.",
          cta: "Try again",
        },
      };
      return NextResponse.json(noResult);
    }

    // ------------------------------------------------------------------
    // 5. Return candidates for the frontend to run locally
    //    (The frontend will execute the boss harness in Pyodide,
    //     then call back for minimization if needed.)
    // ------------------------------------------------------------------
    //
    // NOTE: The actual test execution happens client-side in Pyodide.
    // This API route only generates the adversarial inputs via Gemini.
    // The frontend receives the candidates, runs each through the boss
    // test harness, and then performs minimization locally.
    //
    // We return the full Gemini output so the frontend has:
    //   - The target method (for selecting the correct boss script)
    //   - All candidate seed arrays
    //   - The strategy reasoning (for display)
    //   - Model metadata
    // ------------------------------------------------------------------

    return NextResponse.json({
      status: "candidates_ready",
      targetMethod,
      strategy: geminiResult.strategy,
      candidates: geminiResult.candidate_inputs,
      model: {
        provider: "gemini" as const,
        model: GEMINI_MODEL,
        reasoningSummary: geminiResult.strategy,
      },
    });
  } catch (err) {
    console.error("[challenge] Unexpected error:", err);
    const errorResponse: ChallengeResponse = {
      status: "error",
      ui: {
        headline: "Boss fight crashed!",
        hint:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred.",
        cta: "Try again",
      },
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
