/**
 * JSON Schemas for Chrome Prompt API responseConstraint.
 * Used by useNanoExplanation to get structured output from Gemini Nano per error type.
 */

import type { ErrorCode } from "@/lib/errorCategorization";

/** JSON Schema type (subset used by Chrome responseConstraint) */
export type JsonSchema = Record<string, unknown>;

/** COMPILATION_ERROR: explanation + optional fix snippet */
export const syntaxSchema: JsonSchema = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "Brief plain-language explanation of the syntax error" },
    fix_code: { type: "string", description: "Short code snippet or fix suggestion" },
  },
  required: ["explanation", "fix_code"],
  additionalProperties: false,
};

/** TIMEOUT: analysis + optimization tip */
export const timeoutSchema: JsonSchema = {
  type: "object",
  properties: {
    analysis: { type: "string", description: "Brief analysis of why the code might be timing out" },
    optimization_tip: { type: "string", description: "Concrete tip to make the code faster" },
  },
  required: ["analysis", "optimization_tip"],
  additionalProperties: false,
};

/** Fallback (RUNTIME_ERROR / TEST_FAILED): explanation + analogy */
export const logicSchema: JsonSchema = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "Brief explanation of what went wrong" },
    analogy: { type: "string", description: "Simple analogy or tip to fix the issue" },
  },
  required: ["explanation", "analogy"],
  additionalProperties: false,
};

export interface SyntaxExplanationResult {
  explanation: string;
  fix_code: string;
}

export interface TimeoutExplanationResult {
  analysis: string;
  optimization_tip: string;
}

export interface LogicExplanationResult {
  explanation: string;
  analogy: string;
}

export type NanoExplanationResult =
  | SyntaxExplanationResult
  | TimeoutExplanationResult
  | LogicExplanationResult;

export function getSchemaForErrorCode(errorCode: ErrorCode): JsonSchema {
  switch (errorCode) {
    case "COMPILATION_ERROR":
      return syntaxSchema;
    case "TIMEOUT":
      return timeoutSchema;
    case "RUNTIME_ERROR":
    case "TEST_FAILED":
    default:
      return logicSchema;
  }
}
