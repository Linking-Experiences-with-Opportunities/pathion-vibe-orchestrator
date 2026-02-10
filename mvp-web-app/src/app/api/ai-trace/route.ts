import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// Tuned for Gemini 3 Flash: short, structured, strict format so output is reliable and parseable.
const SYSTEM_PROMPT = `You are an expert runtime debugger. The user's code failed a test. Do NOT only give a fix.

Your job:
1. Use the **Actual Memory State** (JSON) and **Failed test context** to trace execution.
2. Find where the program state diverges from what it should be (e.g. "At iteration 3, node X should point to Y but points to Z").
3. Answer in this exact order, keep each section 1–3 sentences:
   - **Actual state:** What the memory/visualization shows (wrong link, wrong value, extra node, etc.).
   - **Expected state:** What it should be for the test to pass.
   - **Logic drift:** One sentence on why the code produced the actual state (off-by-one, missing update, wrong condition).
   - **Fix:** One concrete fix (e.g. "Fix: Move line 14 inside the loop" or "Fix: Initialize prev before the loop.").

Be concise. No preamble. No code blocks unless the fix is a single line.`;

export interface AITraceRequestBody {
  code: string;
  language: string;
  problemDescription: string;
  failedTestInput: string;
  actualOutput: string;
  errorLog: string;
  vizPayload?: any; // New field for visualization data
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body: AITraceRequestBody = await request.json();
    const {
      code,
      language = "python",
      problemDescription,
      failedTestInput,
      actualOutput,
      errorLog,
      vizPayload,
    } = body;

    if (!code) {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const userPrompt = [
      "Problem / task:",
      problemDescription || "(not provided)",
      "",
      "Failed test context:",
      failedTestInput || "(not provided)",
      "",
      "Actual output from the code:",
      actualOutput || "(not provided)",
      "",
      "Error / log output:",
      errorLog || "(not provided)",
      "",
      "Actual Memory State (JSON Capture):",
      vizPayload ? JSON.stringify(vizPayload, null, 2) : "(not provided)",
      vizPayload?.viz?.truncated ? "\nWARNING: The visualization was TRUNCATED (graph too large, likely infinite loop). Factor this into your diagnosis." : "",
      "",
      "User code:",
      "```" + language + "\n" + code + "\n```",
      "",
      "Respond in order: **Actual state** → **Expected state** → **Logic drift** → **Fix** (each 1–3 sentences)."
    ].join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 1.0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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

    return NextResponse.json({ trace: text });
  } catch (err) {
    console.error("[ai-trace]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI trace failed" },
      { status: 500 }
    );
  }
}
