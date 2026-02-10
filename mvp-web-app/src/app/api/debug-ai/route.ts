import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { StateSnapshot } from "@/lib/vizPayload";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Which Gemini model to use. Prefer flash for speed + cost. */
const GEMINI_MODEL = "gemini-2.0-flash-thinking-exp-01-21";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DebugRequest {
    stateSnapshot: StateSnapshot;
    testName?: string;
    errorMessage?: string;
}

interface GeminiDebugOutput {
    observation: string;
    nudge: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Call Gemini to analyze the runtime state snapshot.
 */
async function callGemini(
    reqBody: DebugRequest,
    apiKey: string
): Promise<GeminiDebugOutput | null> {
    try {
        const ai = new GoogleGenAI({ apiKey });

        // Construct a concise prompt
        const prompt = `
You are an expert Computer Science Tutor.
You are helping a student debug a data structure assignment.

Here is the runtime state snapshot of their data structure at the moment of failure:
\`\`\`json
${JSON.stringify(reqBody.stateSnapshot, null, 2)}
\`\`\`

Test Case: "${reqBody.testName || "Unknown"}"
Error Message: "${reqBody.errorMessage || "None"}"

The student's implementation likely has a logical bug.
Your goal is to provide two pieces of feedback:
1. **observation**: A short, specific diagnosis of what looks wrong in the state. Don't be vague. Point out specific values (e.g., "Size is 5 but actual node count is 4").
2. **nudge**: A helpful hint or question to guide them to the fix, without giving away the exact code.

Return ONLY a valid JSON object with this structure:
{
  "observation": "...",
  "nudge": "..."
}
`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            config: {
                temperature: 0.7, // slightly creative but focused
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                responseMimeType: "application/json",
            },
            contents: prompt,
        });

        const text = response.text;
        if (!text) return null;

        // Parse JSON
        const parsed = JSON.parse(text) as GeminiDebugOutput;

        // Basic validation
        if (!parsed.observation || !parsed.nudge) {
            return null;
        }

        return parsed;
    } catch (err) {
        console.error("[debug-ai] Gemini call failed:", err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    try {
        // 1. Parse request
        const body = await request.json() as DebugRequest;

        if (!body.stateSnapshot) {
            return NextResponse.json(
                { error: "stateSnapshot is required" },
                { status: 400 }
            );
        }

        // 2. Check API Key
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("[debug-ai] No API key configured");
            return NextResponse.json(
                { error: "AI service not configured" },
                { status: 500 }
            );
        }

        // 3. Call Gemini
        const result = await callGemini(body, apiKey);

        if (!result) {
            return NextResponse.json(
                { error: "Could not generate insight" },
                { status: 500 }
            );
        }

        // 4. Return result
        return NextResponse.json(result);

    } catch (err) {
        console.error("[debug-ai] Unexpected error:", err);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
