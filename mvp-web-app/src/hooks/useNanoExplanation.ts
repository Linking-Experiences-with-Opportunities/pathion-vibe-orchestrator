"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ErrorCode } from "@/lib/errorCategorization";
import type { UniversalErrorCode } from "@/lib/errorCodeMapper";
import {
  getSchemaForErrorCode,
  type NanoExplanationResult,
} from "./nanoExplanationSchemas";

/** Map UniversalErrorCode (or ErrorCode) to schema-friendly ErrorCode for responseConstraint and schema string */
function toSchemaErrorCode(code: UniversalErrorCode | ErrorCode | null | undefined): ErrorCode {
  if (!code) return "RUNTIME_ERROR";
  const u = code as string;
  if (u === "COMPILATION_ERROR" || u === "TIMEOUT" || u === "RUNTIME_ERROR" || u === "TEST_FAILED") return u as ErrorCode;
  return "RUNTIME_ERROR"; // MEMORY_LIMIT, MISSING_EXPECTED_ERROR, etc.
}

/**
 * Adaptive system prompt: Persona (by UniversalErrorCode) + strict JSON schema instruction.
 * Ensures the model outputs parsable JSON for Explanation and Tip UI.
 */
function getSystemPrompt(errorCode: UniversalErrorCode | ErrorCode | null | undefined): string {
  let persona: string;
  switch (errorCode) {
    case "COMPILATION_ERROR":
      persona = "You are a Python Syntax Expert. The user has a typo or indentation error. Point out exactly where the syntax is broken. Do not talk about logic.";
      break;
    case "TIMEOUT":
      persona = "You are a Performance Engineer. The user's code is running infinitely or too slowly. Look for while loops without exit conditions or inefficient nested loops.";
      break;
    case "MEMORY_LIMIT":
      persona = "You are a Systems Engineer. The user's code is consuming too much RAM. Look for infinite recursion or massive list allocations.";
      break;
    case "MISSING_EXPECTED_ERROR":
      persona = "You are a Testing Tutor. The user needed to raise a specific exception but didn't. Explain how to raise exceptions in Python.";
      break;
    case "RUNTIME_ERROR":
    case "TEST_FAILED":
    default:
      persona = "You are a helpful coding tutor. Explain the bug simply.";
  }
  const schemaCode = toSchemaErrorCode(errorCode);
  const schema = getSchemaForErrorCode(schemaCode);
  const schemaString = JSON.stringify(schema);
  return `${persona}\n\nYou must respond with a strict JSON object matching this schema: ${schemaString}`;
}

/** Model availability status from the Prompt API */
type AvailabilityStatus = "available" | "downloadable" | "downloading" | "unavailable" | "checking" | "unsupported";

interface UseNanoExplanationResult {
  /** Generate an explanation for the given error (returns structured JSON). Pass result.errorCode (backend truth); fallback to regex-derived code when null/undefined. */
  generateExplanation: (errorCode: UniversalErrorCode | ErrorCode | null, rawMessage: string) => Promise<void>;
  /** The generated structured result (explanation + tip fields per schema), or null */
  explanationResult: NanoExplanationResult | null;
  /** Whether the explanation is being generated */
  loading: boolean;
  /** Error message if generation failed */
  error: string | null;
  /** Whether the Chrome Prompt API is ready to use */
  isAvailable: boolean;
  /** Detailed availability status */
  availabilityStatus: AvailabilityStatus;
}

/**
 * Get the LanguageModel API - Chrome exposes it in different ways depending on version
 */
function getLanguageModelAPI(): typeof LanguageModel | null {
  // Try global LanguageModel first (newer API)
  if (typeof LanguageModel !== "undefined") {
    console.log("[useNanoExplanation] Found global LanguageModel");
    return LanguageModel;
  }
  
  // Try window.ai.languageModel (older API path)
  if (typeof window !== "undefined" && (window as any).ai?.languageModel) {
    console.log("[useNanoExplanation] Found window.ai.languageModel");
    return (window as any).ai.languageModel;
  }

  // Try self.ai.languageModel (service worker compatible)
  if (typeof self !== "undefined" && (self as any).ai?.languageModel) {
    console.log("[useNanoExplanation] Found self.ai.languageModel");
    return (self as any).ai.languageModel;
  }

  console.log("[useNanoExplanation] No LanguageModel API found");
  console.log("[useNanoExplanation] typeof LanguageModel:", typeof LanguageModel);
  console.log("[useNanoExplanation] window.ai:", typeof window !== "undefined" ? (window as any).ai : "N/A");
  
  return null;
}

/**
 * Hook for generating human-readable error explanations using Chrome's Prompt API (Gemini Nano)
 */
export function useNanoExplanation(): UseNanoExplanationResult {
  const [explanationResult, setExplanationResult] = useState<NanoExplanationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>("checking");

  // Track the session for cleanup
  const sessionRef = useRef<any>(null);
  const apiRef = useRef<typeof LanguageModel | null>(null);

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      const api = getLanguageModelAPI();
      
      if (!api) {
        setAvailabilityStatus("unsupported");
        return;
      }

      apiRef.current = api;

      try {
        // Use the availability() method to check model status
        const status = await api.availability();
        console.log("[useNanoExplanation] Model availability:", status);
        setAvailabilityStatus(status);
      } catch (err) {
        console.error("[useNanoExplanation] Error checking availability:", err);
        setAvailabilityStatus("unsupported");
      }
    };

    checkAvailability();
  }, []);

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current?.destroy) {
        sessionRef.current.destroy();
        sessionRef.current = null;
      }
    };
  }, []);

  const isAvailable = availabilityStatus === "available";

  const generateExplanation = useCallback(
    async (errorCode: UniversalErrorCode | ErrorCode | null, rawMessage: string) => {
      const api = apiRef.current;

      if (!api) {
        setError("Chrome Prompt API is not available in this browser");
        return;
      }

      if (availabilityStatus === "unavailable") {
        setError("Gemini Nano model is not available");
        return;
      }

      if (availabilityStatus === "downloadable") {
        setError("Gemini Nano model needs to be downloaded. Check chrome://components");
        return;
      }

      if (availabilityStatus === "downloading") {
        setError("Gemini Nano model is still downloading. Please wait and try again.");
        return;
      }

      if (availabilityStatus !== "available") {
        setError("Model not ready yet");
        return;
      }

      setLoading(true);
      setError(null);
      setExplanationResult(null);

      try {
        const systemPrompt = getSystemPrompt(errorCode);
        const schemaCode = toSchemaErrorCode(errorCode);
        const responseConstraint = getSchemaForErrorCode(schemaCode);

        const session = await api.create({
          initialPrompts: [
            { role: "system", content: systemPrompt },
          ],
        });

        sessionRef.current = session;

        const userPrompt = `Error Category: ${errorCode ?? "unknown"}
Raw Error: "${rawMessage}"

Respond with a JSON object matching the schema: explain the error and provide the requested fields.`;

        const result = await session.prompt(userPrompt, {
          responseConstraint,
        });

        const parsed = JSON.parse(result) as NanoExplanationResult;
        setExplanationResult(parsed);

        session.destroy();
        sessionRef.current = null;
      } catch (err) {
        console.error("[useNanoExplanation] Error generating explanation:", err);
        setError(err instanceof Error ? err.message : "Failed to generate explanation");
      } finally {
        setLoading(false);
      }
    },
    [availabilityStatus]
  );

  return {
    generateExplanation,
    explanationResult,
    loading,
    error,
    isAvailable,
    availabilityStatus,
  };
}