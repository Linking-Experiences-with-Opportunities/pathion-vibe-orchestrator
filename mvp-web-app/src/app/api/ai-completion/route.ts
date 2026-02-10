import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TEMPERATURE = 1.0;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_MODEL;
    const temperature =
      typeof body.temperature === "number" && body.temperature >= 0
        ? body.temperature
        : DEFAULT_TEMPERATURE;

    if (!prompt) {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' in body" },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      config: {
        temperature,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
      contents: prompt,
    });

    const text = response.text ?? "";

    return NextResponse.json({ text, content: text });
  } catch (err) {
    console.error("[ai-completion] Error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "AI completion request failed",
      },
      { status: 500 }
    );
  }
}
