/**
 * aiCompressor - Offline event compression using Chrome's built-in Gemini Nano
 * 
 * Uses the Prompt API (global LanguageModel) to summarize cached events
 * when offline and cache pressure is high. Throws NanoUnavailableError
 * when Gemini Nano is not available — callers must handle the error.
 * 
 * Reference: https://developer.chrome.com/docs/ai/built-in
 */

import type { ActionEvent } from "./actionLogger";

// ============================================================================
// Logging
// ============================================================================

const LOG_PREFIX = "[AICompressor]";
const STYLES = {
  header:  "color: #00E5FF; font-weight: bold",           // Cyan
  ai:      "color: #E040FB; font-weight: bold",           // Pink/Purple (AI)
  success: "color: #4CAF50; font-weight: bold",           // Green
  warning: "color: #FF9800; font-weight: bold",           // Orange
  error:   "color: #F44336; font-weight: bold",           // Red
  info:    "color: #29B6F6; font-weight: bold",           // Light Blue
  prompt:  "color: #AB47BC",                               // Purple
  data:    "color: #78909C",                               // Blue-grey
};

function compLog(msg: string, style: string = STYLES.info, data?: unknown): void {
  if (data !== undefined) {
    console.log(`%c${LOG_PREFIX} ${msg}`, style, data);
  } else {
    console.log(`%c${LOG_PREFIX} ${msg}`, style);
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CompressedBundle {
  id: string;                           // UUID
  summary: string;                      // AI-generated summary of events
  eventCount: number;                   // Number of events compressed
  eventTypes: Record<string, number>;   // Type breakdown { page_enter: 3, submit_click: 1, ... }
  timeRange: { start: number; end: number };
  compressed: true;                     // Flag for backend
  sessionId: string;
}

// Chrome Prompt API types (global LanguageModel)
// Reference: https://developer.chrome.com/docs/ai/prompt-api

type PromptMessage = { role: "system" | "user" | "assistant"; content: string };

interface AILanguageModelSession {
  // The Prompt API supports either a single string OR a message array.
  prompt(input: string | PromptMessage[]): Promise<string>;
  destroy(): void;
}

type NanoCreateOptions = {
  // Newer Prompt API uses expectedInputs/expectedOutputs to declare language + modality.
  expectedInputs?: Array<{ type: "text"; languages?: string[] }>;
  expectedOutputs?: Array<{ type: "text"; languages?: string[] }>;
  // Some examples/docs also show languages at top-level; keep optional for forward/back compat.
  languages?: string[];
  initialPrompts?: PromptMessage[];
  monitor?: (m: unknown) => void;
};

interface LanguageModelAPI {
  availability(options?: NanoCreateOptions): Promise<string>;
  create(options?: NanoCreateOptions): Promise<AILanguageModelSession>;
  params(): Promise<{
    defaultTopK: number;
    maxTopK: number;
    defaultTemperature: number;
    maxTemperature: number;
  }>;
}

/**
 * Get the LanguageModel API - Chrome exposes it in different ways depending on version.
 * Tries multiple access paths for compatibility.
 */
function getLanguageModel(): LanguageModelAPI | null {
  // Try global LanguageModel first (newer API)
  if (typeof globalThis !== "undefined" && (globalThis as any).LanguageModel) {
    compLog("Found global LanguageModel", STYLES.info);
    return (globalThis as any).LanguageModel as LanguageModelAPI;
  }

  // Try window.ai.languageModel (older API path)
  if (typeof window !== "undefined" && (window as any).ai?.languageModel) {
    compLog("Found window.ai.languageModel", STYLES.info);
    return (window as any).ai.languageModel as LanguageModelAPI;
  }

  // Try self.ai.languageModel (service worker compatible)
  if (typeof self !== "undefined" && (self as any).ai?.languageModel) {
    compLog("Found self.ai.languageModel", STYLES.info);
    return (self as any).ai.languageModel as LanguageModelAPI;
  }

  compLog("No LanguageModel API found", STYLES.warning);
  return null;
}

// ============================================================================
// Gemini Nano Availability
// ============================================================================

let nanoAvailability: "unknown" | "available" | "downloadable" | "downloading" | "unavailable" = "unknown";
let nanoSession: AILanguageModelSession | null = null;

/**
 * Call this from a click/keypress handler to ensure a Nano session exists.
 * Many Chrome AI surfaces require user activation for download + session creation.
 */
export async function initNanoFromUserGesture(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const LM = getLanguageModel();
  if (!LM) {
    nanoAvailability = "unavailable";
    compLog("🤖 Gemini Nano: LanguageModel API not found (not supported in this browser)", STYLES.warning);
    return false;
  }

  try {
    const availability = await LM.availability();
    nanoAvailability = availability as typeof nanoAvailability;
    compLog(
      `🤖 Gemini Nano availability (init): "${availability}"`,
      availability === "available" ? STYLES.success : STYLES.warning
    );

    if (availability === "unavailable") return false;

    // Create the session now and reuse later.
    if (!nanoSession) {
      compLog("🤖 Creating Nano session...", STYLES.ai);
      const start = performance.now();
      nanoSession = await LM.create();
      compLog(`🤖 Session created (${(performance.now() - start).toFixed(0)}ms)`, STYLES.success);
    }

    return true;
  } catch (err) {
    nanoAvailability = "unavailable";
    compLog(`❌ Nano init failed: ${err}`, STYLES.error);
    return false;
  }
}

/**
 * Check if Gemini Nano is available in this browser
 */
export async function isNanoAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const LM = getLanguageModel();
    if (!LM) {
      nanoAvailability = "unavailable";
      compLog("🤖 Gemini Nano: LanguageModel API not found (not supported in this browser)", STYLES.warning);
      return false;
    }

    const availability = await LM.availability();
    nanoAvailability = availability as typeof nanoAvailability;
    compLog(`🤖 Gemini Nano availability: "${availability}"`, availability === "available" ? STYLES.success : STYLES.warning);
    return availability === "available";
  } catch (err) {
    nanoAvailability = "unavailable";
    compLog(`🤖 Gemini Nano check failed: ${err}`, STYLES.error);
    return false;
  }
}

/**
 * Get or create a Gemini Nano session
 */
async function getNanoSession(): Promise<AILanguageModelSession | null> {
  if (nanoSession) {
    compLog("🤖 Reusing existing Nano compressor session", STYLES.ai);
    return nanoSession;
  }

  try {
    const LM = getLanguageModel();
    if (!LM) return null;

    compLog("🤖 Creating new Nano compressor session...", STYLES.ai);
    const start = performance.now();
    nanoSession = await LM.create();
    compLog(`🤖 Session created (${(performance.now() - start).toFixed(0)}ms)`, STYLES.success);
    return nanoSession;
  } catch (err) {
    compLog(`❌ Failed to create Nano session: ${err}`, STYLES.error);
    return null;
  }
}

/**
 * Destroy the current Nano session (free resources)
 */
export function destroyNanoSession(): void {
  if (nanoSession) {
    compLog("🧹 Destroying Nano compressor session", STYLES.info);
    try {
      nanoSession.destroy();
    } catch {
      // Ignore cleanup errors
    }
    nanoSession = null;
    nanoAvailability = "unknown";
  }
}

// ============================================================================
// Errors
// ============================================================================

/** Thrown when Gemini Nano is required but not available or not functional. */
export class NanoUnavailableError extends Error {
  constructor(reason: string) {
    super(`Gemini Nano unavailable: ${reason}`);
    this.name = "NanoUnavailableError";
  }
}

// ============================================================================
// Compression Logic
// ============================================================================

/**
 * Build a structured summary of events for the AI prompt
 */
function buildEventSummaryForPrompt(events: ActionEvent[]): string {
  // Group events by type
  const byType: Record<string, ActionEvent[]> = {};
  for (const event of events) {
    if (!byType[event.type]) byType[event.type] = [];
    byType[event.type].push(event);
  }

  const lines: string[] = [];
  lines.push(`Total events: ${events.length}`);
  lines.push(`Time range: ${new Date(events[0].timestamp).toISOString()} to ${new Date(events[events.length - 1].timestamp).toISOString()}`);
  lines.push("");

  for (const [type, typeEvents] of Object.entries(byType)) {
    lines.push(`${type}: ${typeEvents.length} events`);

    // Add specific details per type
    if (type === "page_enter" || type === "page_exit") {
      const pages = Array.from(new Set(typeEvents.map(e => e.target).filter(Boolean)));
      lines.push(`  Pages: ${pages.join(", ")}`);
    }
    if (type === "submit_click" || type === "run_code_click") {
      const targets = Array.from(new Set(typeEvents.map(e => e.target).filter(Boolean)));
      lines.push(`  Targets: ${targets.join(", ")}`);
    }
    if (type === "input_diff") {
      const projects = Array.from(new Set(typeEvents.map(e => e.diff?.projectId).filter(Boolean)));
      lines.push(`  Projects: ${projects.join(", ")}`);
      const totalChars = typeEvents.reduce((sum, e) => sum + (e.diff?.charCount || 0), 0);
      lines.push(`  Total chars changed: ${totalChars}`);
    }
    if (type === "lesson_start" || type === "lesson_complete") {
      const modules = Array.from(new Set(typeEvents.map(e => e.metadata?.moduleId as string).filter(Boolean)));
      lines.push(`  Modules: ${modules.join(", ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Compress events using Gemini Nano.
 * Throws NanoUnavailableError if Nano is not available or session cannot be obtained.
 * Throws on prompt failure. Callers must handle errors explicitly.
 */
export async function compressEvents(
  events: ActionEvent[],
  sessionId: string
): Promise<CompressedBundle> {
  if (events.length === 0) {
    throw new Error("Cannot compress an empty event array");
  }

  const durationSec = Math.round((events[events.length - 1].timestamp - events[0].timestamp) / 1000);
  console.groupCollapsed(
    `%c${LOG_PREFIX} 📦 Compressing ${events.length} events (${durationSec}s span)`,
    STYLES.header
  );

  // Calculate event type breakdown
  const eventTypes: Record<string, number> = {};
  for (const event of events) {
    eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
  }

  console.log(`%c  Event type breakdown:`, STYLES.data);
  console.table(eventTypes);

  const timeRange = {
    start: events[0].timestamp,
    end: events[events.length - 1].timestamp,
  };

  // Require Nano — treat unavailability as an error
  const available = await isNanoAvailable();

  if (!available) {
    const hint = nanoAvailability !== "unavailable"
      ? ` (status: "${nanoAvailability}" — call initNanoFromUserGesture() from a user action to allow download/session creation)`
      : "";
    compLog(`❌ Gemini Nano is NOT available — aborting compression${hint}`, STYLES.error);
    console.groupEnd();
    throw new NanoUnavailableError(
      `Nano is not available in this browser or has not been initialized${hint}`
    );
  }

  const session = await getNanoSession();
  if (!session) {
    compLog("❌ Could not obtain Nano session", STYLES.error);
    console.groupEnd();
    throw new NanoUnavailableError(
      "Could not obtain a Nano session (may require a user gesture — call initNanoFromUserGesture())"
    );
  }

  const eventSummary = buildEventSummaryForPrompt(events);
  const prompt = `You are summarizing user activity events from a coding education platform. Provide a brief, structured summary of what the user did during this session. Focus on: pages visited, code actions taken, problems attempted, and learning progress. Keep it under 200 words.

Event data:
${eventSummary}

Summary:`;

  compLog(`🤖 Sending prompt to Nano (${prompt.length} chars)...`, STYLES.ai);
  console.groupCollapsed(`%c${LOG_PREFIX} 🤖 Compression Prompt`, STYLES.prompt);
  console.log(prompt);
  console.groupEnd();

  let summary: string;
  try {
    const start = performance.now();
    summary = await session.prompt(prompt);
    const elapsed = performance.now() - start;
    compLog(`🤖 Nano compression complete (${elapsed.toFixed(0)}ms, ${summary.length} chars)`, STYLES.success);
  } catch (err) {
    compLog(`❌ Nano compression prompt failed: ${err}`, STYLES.error);
    console.groupEnd();
    throw err;
  }

  const bundle: CompressedBundle = {
    id: generateBundleId(),
    summary,
    eventCount: events.length,
    eventTypes,
    timeRange,
    compressed: true,
    sessionId,
  };

  compLog(`✅ Bundle created: ${bundle.id}`, STYLES.success);
  console.log(`%c  Method: 🤖 Gemini Nano`, STYLES.data);
  console.log(`%c  Summary: "${summary.slice(0, 120)}${summary.length > 120 ? "..." : ""}"`, STYLES.data);
  console.groupEnd();

  return bundle;
}

/**
 * Build a deterministic summary without AI.
 * Exported so callers can explicitly use this as a fallback when Nano is unavailable.
 */
export function buildFallbackSummary(
  events: ActionEvent[],
  eventTypes: Record<string, number>,
  timeRange: { start: number; end: number }
): string {
  const duration = Math.round((timeRange.end - timeRange.start) / 1000);
  const pages = Array.from(new Set(events.filter(e => e.type === "page_enter").map(e => e.target).filter(Boolean)));
  const projects = Array.from(new Set(events.filter(e => e.diff?.projectId).map(e => e.diff!.projectId).filter(Boolean)));

  const lines: string[] = [
    `[Compressed] ${events.length} events over ${duration}s`,
    `Types: ${Object.entries(eventTypes).map(([k, v]) => `${k}(${v})`).join(", ")}`,
  ];

  if (pages.length > 0) lines.push(`Pages: ${pages.join(", ")}`);
  if (projects.length > 0) lines.push(`Projects: ${projects.join(", ")}`);

  const submits = events.filter(e => e.type === "submit_click").length;
  const runs = events.filter(e => e.type === "run_code_click").length;
  if (submits > 0 || runs > 0) {
    lines.push(`Code: ${runs} runs, ${submits} submits`);
  }

  return lines.join(" | ");
}

function generateBundleId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `bundle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get Nano availability status (for debugging)
 */
export function getNanoStatus(): string {
  return nanoAvailability;
}
