/**
 * profileNanoEditor - Session-based profile narratives via Gemini Nano
 *
 * Canonical profile updates are driven by Sessions and Session Artifacts
 * (see .cursor/plans/shared_instrumentation_and_metrics_506970d1.plan.md).
 * This module provides:
 * - generateUnifiedSessionNarrative(artifact): One multi-tier bullet list from full artifact (summary, diffs, finalCode, testLogs)
 * - updateSessionNarratives(summary): Writes narrative into ProfileInsights.sessionSummaryNarrative
 * - initProfileNanoFromUserGesture(): Warms up Nano from a user gesture (required for LM.create in some browsers)
 */

import { initNanoFromUserGesture } from "./aiCompressor";
import {
  getCurrentProfile,
  updateProfileLocally,
  acquireEditLock,
  releaseEditLock,
  type ProfileInsights,
} from "./profileManager";
import type { SessionSummary, SessionArtifact } from "./sessionSummary";

// ============================================================================
// Logging
// ============================================================================

const LOG_PREFIX = "[ProfileNanoEditor]";
const STYLES = {
  header:  "color: #FF6D00; font-weight: bold",           // Deep Orange
  ai:      "color: #E040FB; font-weight: bold",           // Pink/Purple (AI)
  success: "color: #4CAF50; font-weight: bold",           // Green
  warning: "color: #FF9800; font-weight: bold",           // Orange
  error:   "color: #F44336; font-weight: bold",           // Red
  info:    "color: #29B6F6; font-weight: bold",           // Light Blue
  heur:    "color: #FDD835; font-weight: bold",           // Yellow (Heuristics)
  prompt:  "color: #AB47BC",                               // Purple (Prompt text)
  data:    "color: #78909C",                               // Blue-grey
};

function nanoLog(msg: string, style: string = STYLES.info, data?: unknown): void {
  if (data !== undefined) {
    console.log(`%c${LOG_PREFIX} ${msg}`, style, data);
  } else {
    console.log(`%c${LOG_PREFIX} ${msg}`, style);
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
// Types
// ============================================================================
// Canonical profile updates are now driven by Sessions and Session Artifacts
// (see .cursor/plans/shared_instrumentation_and_metrics_506970d1.plan.md).
// updateSessionNarratives(summary) and ProfileInsights are the supported path.

// Chrome Prompt API types (global LanguageModel)
// Reference: https://developer.chrome.com/docs/ai/prompt-api
type PromptMessage = { role: "system" | "user" | "assistant"; content: string };

interface AILanguageModelSession {
  // The Prompt API supports either a single string OR a message array.
  prompt(input: string | PromptMessage[]): Promise<string>;
  destroy(): void;
}

type NanoCreateOptions = {
  expectedInputs?: Array<{ type: "text"; languages?: string[] }>;
  expectedOutputs?: Array<{ type: "text"; languages?: string[] }>;
  // Optional for back/forward compatibility with examples that still show `languages`.
  languages?: string[];
  initialPrompts?: PromptMessage[];
  monitor?: (m: unknown) => void;
};

interface LanguageModelAPI {
  availability(options?: NanoCreateOptions): Promise<string>;
  create(options?: NanoCreateOptions): Promise<AILanguageModelSession>;
}

/**
 * Get the LanguageModel API - Chrome exposes it in different ways depending on version.
 * Tries multiple access paths for compatibility.
 */
function getLanguageModel(): LanguageModelAPI | null {
  // Try global LanguageModel first (newer API)
  if (typeof globalThis !== "undefined" && (globalThis as any).LanguageModel) {
    nanoLog("Found global LanguageModel", STYLES.info);
    return (globalThis as any).LanguageModel as LanguageModelAPI;
  }

  // Try window.ai.languageModel (older API path)
  if (typeof window !== "undefined" && (window as any).ai?.languageModel) {
    nanoLog("Found window.ai.languageModel", STYLES.info);
    return (window as any).ai.languageModel as LanguageModelAPI;
  }

  // Try self.ai.languageModel (service worker compatible)
  if (typeof self !== "undefined" && (self as any).ai?.languageModel) {
    nanoLog("Found self.ai.languageModel", STYLES.info);
    return (self as any).ai.languageModel as LanguageModelAPI;
  }

  nanoLog("No LanguageModel API found", STYLES.warning);
  return null;
}

// ============================================================================
// Nano Session (dedicated for profile editing)
// ============================================================================

let nanoProfileSession: AILanguageModelSession | null = null;

// Call this from a click/keypress handler to ensure profile Nano session exists.
// This mirrors the compressor init flow (many Chrome AI surfaces require user activation).
export async function initProfileNanoFromUserGesture(): Promise<boolean> {
  if (nanoProfileSession) return true;

  const LM = getLanguageModel();
  if (!LM) {
    nanoLog("⚠️  Nano API (LanguageModel) not available in this browser", STYLES.warning);
    return false;
  }

  try {
    // Avoid extra awaits before LM.create() so we don't lose user activation.
    nanoLog("🤖 Creating Nano session for profile editing...", STYLES.ai);
    const start = performance.now();
    nanoProfileSession = await LM.create({
      initialPrompts: [
        { role: "system", content: "You are updating a student's skill profile on a coding education platform. Respond with only valid JSON." },
      ],
    });
    nanoLog(`🤖 Nano profile session created (${(performance.now() - start).toFixed(0)}ms)`, STYLES.success);

    // Warm shared Nano plumbing in the background; don't block gesture-critical session creation.
    void initNanoFromUserGesture().catch((err) => {
      nanoLog(`⚠️ Shared Nano warmup failed: ${err}`, STYLES.warning);
    });
    return true;
  } catch (err) {
    nanoLog(`❌ Failed to init Nano profile session: ${err}`, STYLES.error);
    return false;
  }
}

async function getProfileNanoSession(): Promise<AILanguageModelSession | null> {
  if (nanoProfileSession) {
    nanoLog("🤖 Reusing existing Nano session", STYLES.ai);
    return nanoProfileSession;
  }

  const LM = getLanguageModel();
  if (!LM) {
    nanoLog("⚠️  Nano API (LanguageModel) not available in this browser", STYLES.warning);
    return null;
  }

  // If we’re not in a user gesture, session creation can fail even though it works in DevTools.
  // Prefer calling initProfileNanoFromUserGesture() from a click/keypress to warm this up.
  try {
    const availability = await LM.availability();
    nanoLog(`🤖 Gemini Nano availability (profile): "${availability}"`, availability === "available" ? STYLES.success : STYLES.warning);
    if (availability === "unavailable") return null;

    nanoLog("🤖 Creating new Nano session for profile editing...", STYLES.ai);
    const start = performance.now();
    nanoProfileSession = await LM.create({
      initialPrompts: [
        { role: "system", content: "You are updating a student's skill profile on a coding education platform. Respond with only valid JSON." },
      ],
    });
    nanoLog(`🤖 Nano profile session created (${(performance.now() - start).toFixed(0)}ms)`, STYLES.success);
    return nanoProfileSession;
  } catch (err) {
    nanoLog(`❌ Failed to create Nano session: ${err}`, STYLES.error);
    return null;
  }
}

function destroyProfileNanoSession(): void {
  if (nanoProfileSession) {
    nanoLog("🧹 Destroying Nano profile session", STYLES.info);
    try {
      nanoProfileSession.destroy();
    } catch {
      // Ignore cleanup errors
    }
    nanoProfileSession = null;
    nanoLog("🧽 Nano profile session cleared", STYLES.data);
  }
}

// ============================================================================
// Session narrative – unified multi-tier bullet list from full artifact
// ============================================================================

/** Build a payload from the full session artifact for the unified narrative. Summary is included without narratives. */
function buildFullArtifactPayload(artifact: SessionArtifact): Record<string, unknown> {
  const { summary, startingCode, squashedDiffs, finalCode, testLogs, testProgress, testCases, diffHistory } = artifact;
  const summaryForPayload = summary.narratives
    ? { ...summary, narratives: undefined }
    : summary;
  return {
    summary: summaryForPayload,
    ...(startingCode && Object.keys(startingCode).length > 0 && { startingCode }),
    ...(squashedDiffs && Object.keys(squashedDiffs).length > 0 && { squashedDiffs }),
    ...(finalCode && Object.keys(finalCode).length > 0 && { finalCode }),
    ...(testLogs && testLogs.length > 0 && { testLogs }),
    ...(testProgress && testProgress.points.length > 0 && { testProgress }),
    ...(testCases && testCases.length > 0 && { testCases }),
    ...(diffHistory && diffHistory.length > 0 && { diffHistory }),
  };
}

const UNIFIED_NARRATIVE_SYSTEM_PROMPT = `You are a coach summarizing this coding practice session as a multi-tier bullet list. Use the full session artifact provided below.

Detail rules (keep detail high):
- Use exact numbers from the artifact: run count, active seconds, "X of Y tests", timeToFirstRunSec, progressPerIteration, etc. Never say "some tests" or "a few runs"—use the actual values.
- Quote error snippets verbatim when present (e.g. testLogs[].errorSnippet). Include the exact phrase like "IndexError not raised" or the exception type and message.
- When squashedDiffs or finalCode exist, name specific files and what changed (e.g. "arraylist.py: added insert(), get(); arraylist_tests.py: unchanged"). At least one sub-bullet on code changes when diffs/code are provided.
- Give at least 2–3 sub-bullets per section when the data supports it. Avoid single vague lines; unpack the metrics into concrete statements.
- Do not claim success or "all tests passed" unless the artifact shows the final run passed with testsPassed === testsTotal.

Output a single string that is a multi-tier pointed list. Use one top-level bullet per section; use nested bullets (indent with 2 spaces and "-" or "•") for details. Cover these sections in this order:

• Velocity/pace — summary.runCount, summary.activeSeconds, summary.velocity, summary.endReason. Include: exact run count, active time in seconds, endReason, whether the session ended with all tests passing.

• First attempt — summary.firstAttempt, summary.runOutcomes[0], testLogs[0]. Include: firstRunCompileSuccess (yes/no), exact "X of Y tests" on first run, timeToFirstRunSec, firstKRunsErrorCount if > 0.

• Iteration — summary.iteration, summary.runOutcomes, testLogs. Include: classification (convergent/thrashing), iterationsToPass, progressPerIteration, and per-run outcomes if few runs (e.g. "run 1: 4/5; run 2: 5/5").

• Test progress — When testProgress is present: use testProgress.points (runIndex, solvedCount) to describe how many test cases were solved after each run. A test is "solved" when it passes and stays passing (unsolved if it fails again later). Interpret the curve: steady gain, plateau, regression, or quick jump. Include total test case count and how many are solved at session end. If testCases is present, you may mention which tests are solved vs unsolved.

• Transfer — summary.conceptsFetched. List concept names or resource IDs if present; otherwise one sub-bullet: "No learning resources consulted."

• Debugging — summary.debugging, testLogs[].errorSnippet. Include: verbatim error snippet(s), diagnosisLatencySec or hypothesisTestCycles if present, whether the session ended with all tests passing.

Add a sub-bullet under the relevant section (or under Iteration) when startingCode/squashedDiffs/finalCode exist: which files changed and a few-line summary (startingCode = code at session start; squashedDiffs = per-file diff; finalCode = code at session end).

Respond with only a JSON object with a single key "narrative" whose value is the multi-tier bullet list string (plain text, newlines and spaces for structure). No markdown code fences.`;

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unwrapped = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // Some model responses come as "json\n{ ... }" without markdown fences.
  return unwrapped.replace(/^json\s*\n/i, "").trim();
}

function normalizeNarrativeValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const lines = value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  return null;
}

function extractNarrativeFromJsonResponse(response: string): string | null {
  const stripped = stripCodeFences(response);
  const candidates: string[] = [stripped];

  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0] !== stripped) candidates.push(jsonMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const normalized = normalizeNarrativeValue(parsed.narrative);
      if (normalized) return normalized;
    } catch {
      // Try the next parse candidate
    }
  }
  return null;
}

/**
 * Prompt Nano for narrative text.
 * Reliability strategy:
 * 1) Try ephemeral session (clean context).
 * 2) If session creation fails (often user-activation related), fall back to warmed shared session.
 */
async function promptNarrativeWithNano(options: {
  systemPrompt: string;
  userPrompt: string;
  label: string;
}): Promise<string | null> {
  const LM = getLanguageModel();
  if (!LM) return null;
  try {
    if ((await LM.availability()) === "unavailable") return null;
  } catch {
    return null;
  }

  // First try: isolated session for this prompt.
  let isolated: AILanguageModelSession | null = null;
  try {
    isolated = await LM.create({
      initialPrompts: [{ role: "system" as const, content: options.systemPrompt }],
    });
    const start = performance.now();
    const response = await isolated.prompt(options.userPrompt);
    const result = extractNarrativeFromJsonResponse(response);
    if (!result) {
      nanoLog(`${options.label} (${(performance.now() - start).toFixed(0)}ms) — no JSON`, STYLES.warning, { raw: response });
      return null;
    }
    nanoLog(`${options.label} (${(performance.now() - start).toFixed(0)}ms)`, STYLES.ai, { output: result });
    return result;
  } catch (err) {
    nanoLog(`${options.label} isolated session failed`, STYLES.warning, { err });
  } finally {
    if (isolated) {
      try {
        isolated.destroy();
      } catch {
        // ignore
      }
    }
  }

  // Second try: warmed shared session created from a user gesture.
  const warmed = await getProfileNanoSession();
  if (!warmed) return null;
  try {
    const start = performance.now();
    const response = await warmed.prompt([
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ]);
    const result = extractNarrativeFromJsonResponse(response);
    if (!result) {
      nanoLog(`${options.label} warmed session (${(performance.now() - start).toFixed(0)}ms) — no JSON`, STYLES.warning, { raw: response });
      return null;
    }
    nanoLog(`${options.label} warmed session (${(performance.now() - start).toFixed(0)}ms)`, STYLES.ai, { output: result });
    return result;
  } catch (err) {
    nanoLog(`${options.label} warmed session failed`, STYLES.error, { err });
    return null;
  }
}

async function promptUnifiedNarrative(payload: Record<string, unknown>): Promise<string | null> {
  const userPrompt = `Session artifact (use this to write the multi-tier bullet list; use exact numbers, error snippets, and git diffs from the data):\n${JSON.stringify(payload)}\n\nRespond with a JSON object with a single key "narrative" whose value is the detailed multi-tier bullet list. Example level of detail: {"narrative": "• Velocity/pace\\n  - Run count: 1; active time: 15s.\\n  - End reason: submit.\\n  - Session did not end with all tests passing.\\n• First attempt\\n  - First run compiled successfully.\\n  - First run: 4 of 5 tests passed; time to first run: 15s.\\n  - firstKRunsErrorCount: 1.\\n• Iteration\\n  - Classification: convergent; iterationsToPass: 1.\\n  - progressPerIteration: 0.\\n• Transfer\\n  - No learning resources consulted.\\n• Debugging\\n  - Last run error: IndexError not raised.\\n  - Session did not end with all tests passing."}`;
  return promptNarrativeWithNano({
    systemPrompt: UNIFIED_NARRATIVE_SYSTEM_PROMPT,
    userPrompt,
    label: "Nano unified narrative",
  });
}

const NANO_OPINION_SYSTEM_PROMPT = `You are a coach reviewing a coding practice session. You will receive the full session artifact (summary metrics, run outcomes, test logs, test progress line-plot if present, squashed diffs, final code).

Your task: produce your own key findings—what stands out, what the learner did well, what might need work, or what you'd suggest next. Use the entirety of the artifact: metrics, error snippets, testProgress (solved count per run), testCases (which tests are solved), code changes, and final code. Be specific and concise.

Consistency rules:
- Every line must be evidence-grounded using artifact facts (numbers, test names, or error snippets).
- Do not claim a method is "correct" unless the relevant tests pass in the final run.
- If the final run is not fully passing, avoid "all good"/"correct overall" language.
- Prefer statements tied to failing tests and error snippets over generic coding advice.

Output 2–5 sub-bullet lines that will be placed under a "• Nano's opinion" heading. Each line must start with "  - " (two spaces, hyphen, space) then your finding. Use plain text; no markdown. Example:
  - Strong first run (4/5 tests) but one edge case left; IndexError handling in get/remove/insert is the likely gap.
  - Single run then submit suggests confidence or time pressure; consider whether invalid_index tests were run.
  - finalCode shows is_empty and _resize still stubbed—good scope control.

Respond with only a JSON object with a single key "narrative" whose value is the string of sub-bullet lines (newline-separated). No markdown code fences.`;

async function promptNanoOpinion(payload: Record<string, unknown>): Promise<string | null> {
  const userPrompt = `Session artifact (review the whole thing and give your key findings as 2–5 lines starting with "  - "):\n${JSON.stringify(payload)}\n\nRespond with a JSON object with a single key "narrative" whose value is the sub-bullet lines string.`;
  return promptNarrativeWithNano({
    systemPrompt: NANO_OPINION_SYSTEM_PROMPT,
    userPrompt,
    label: "Nano opinion",
  });
}

const SESSION_STORY_SYSTEM_PROMPT = `You are a coach describing how the learner's code evolved during this session. You will receive the full session artifact (summary, diffHistory, squashedDiffs, finalCode, testLogs, runOutcomes, etc.). Find the diff-related data (diffHistory and/or squashedDiffs) and use it to tell the story.

Your task: write a short narrative (2–6 sub-bullets) that tells the story of what the user wrote over time. Use diffHistory (per-run diffs) or squashedDiffs when present. Cross-reference with test results (runOutcomes, testLogs): what changed before a passing run vs a failing run. Use concrete file names and method/function names when the diffs show them. If no diffs exist, write one line: "No diff history to explain." Keep each line concise; start each with "  - " (two spaces, hyphen, space). Plain text only; no markdown.

Respond with only a JSON object with a single key "narrative" whose value is the string of sub-bullet lines (newline-separated). No markdown code fences.`;

async function promptSessionStoryFromDiffs(payload: Record<string, unknown>): Promise<string | null> {
  const userPrompt = `Session artifact (find diffHistory/squashedDiffs and describe code evolution; cross-reference with test outcomes):\n${JSON.stringify(payload)}\n\nRespond with a JSON object with a single key "narrative" whose value is the sub-bullet story string.`;
  return promptNarrativeWithNano({
    systemPrompt: SESSION_STORY_SYSTEM_PROMPT,
    userPrompt,
    label: "Nano session story",
  });
}

/**
 * Generate a short "session story" narrative from the full artifact.
 * Nano finds diffHistory/squashedDiffs itself. Returns sub-bullet lines or null.
 */
export async function generateSessionStoryFromDiffs(artifact: SessionArtifact): Promise<string | null> {
  const payload = buildFullArtifactPayload(artifact);
  return promptSessionStoryFromDiffs(payload);
}

/**
 * Generate one multi-tier bullet list narrative from the full session artifact: the five structured sections
 * (velocity, first attempt, iteration, transfer, debugging) plus a separately generated "Nano's opinion"
 * section. Each AI summary uses a new LM session (create/destroy) to avoid context bleeding.
 * Returns the full narrative string or null if the five-section part is unavailable.
 */
export async function generateUnifiedSessionNarrative(artifact: SessionArtifact): Promise<string | null> {
  const payload = buildFullArtifactPayload(artifact);

  const fiveSection = await promptUnifiedNarrative(payload);
  if (!fiveSection) return null;

  let narrative = fiveSection;

  const nanoOpinion = await promptNanoOpinion(payload);
  if (nanoOpinion != null && nanoOpinion.trim().length > 0) {
    narrative = `${narrative}\n\n• Nano's opinion\n${nanoOpinion.trim()}`;
  }

  const hasDiffHistory = !!(artifact.diffHistory && artifact.diffHistory.length > 0);
  const sessionStory = await generateSessionStoryFromDiffs(artifact).catch(() => null);

  if (sessionStory != null && sessionStory.trim().length > 0) {
    narrative = `${narrative}\n\n• Session story (code evolution)\n${sessionStory.trim()}`;
  } else if (hasDiffHistory) {
    narrative = `${narrative}\n\n• Session story (code evolution)\n  - Session story could not be generated.`;
  } else {
    narrative = `${narrative}\n\n• Session story (code evolution)\n  - No diff history to explain.`;
  }

  return narrative;
}

/**
 * Update profile insights from a session summary. Writes the unified narrative to sessionSummaryNarrative.
 */
export async function updateSessionNarratives(summary: SessionSummary): Promise<void> {
  const profile = getCurrentProfile();
  if (!profile) return;

  const narrative = summary.narratives?.narrative;
  if (!narrative) return;

  const gotLock = await acquireEditLock();
  if (!gotLock) return;
  try {
    await updateProfileLocally({
      insights: { sessionSummaryNarrative: narrative } as ProfileInsights,
    });
  } finally {
    releaseEditLock();
  }
}

// ============================================================================
// Cleanup
// ============================================================================

export function cleanupProfileNanoEditor(): void {
  nanoLog("🧹 Cleaning up Profile Nano Editor", STYLES.info);
  destroyProfileNanoSession();
}
