/**
 * Input Diff Tracker - Tracks code changes in the editor
 *
 * Features:
 * - Captures snapshots every 15 seconds if changes exist
 * - Computes simple diffs for efficient storage
 * - Integrates with the action logger and attempt session (diff tick → active/idle)
 */

import { logInputDiff, InputDiffData } from "./actionLogger";

// ============================================================================
// Configuration
// ============================================================================

const LOG_PREFIX = "[InputDiffTracker]";

function shouldLogSessionDebug(): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") return true;
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SESSION_DEBUG === "1") return true;
  if (typeof window !== "undefined") {
    if ((window as unknown as { __SESSION_DEBUG?: boolean }).__SESSION_DEBUG === true) return true;
    try {
      if (localStorage.getItem("SESSION_DEBUG") === "1") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function diffLog(msg: string, data?: Record<string, unknown>): void {
  if (!shouldLogSessionDebug()) return;
  if (data != null) console.log(`${LOG_PREFIX} ${msg}`, data);
  else console.log(`${LOG_PREFIX} ${msg}`);
}

const CONFIG = {
  DIFF_INTERVAL_MS: 15 * 1000, // 15 seconds
  MAX_SNAPSHOT_SIZE: 50000,    // Max chars to store as full snapshot
  DEBUG: process.env.NODE_ENV === "development",
  /** Max chars of diff text to include in logs (with hash) for debugging. */
  DIFF_PREVIEW_LENGTH: 400,
};

// ============================================================================
// Types
// ============================================================================

interface TrackedFile {
  lastSnapshot: string;
  lastSnapshotTime: number;
}

interface TrackerContext {
  projectId?: string;
  problemId?: string;
}

// ============================================================================
// State
// ============================================================================

// Map of fileKey -> tracked file state
const trackedFiles = new Map<string, TrackedFile>();

// Current tracking context
let currentContext: TrackerContext = {};

// Interval timer
let diffTimer: ReturnType<typeof setInterval> | null = null;

// Current content getter function (set by the editor component)
type ContentGetter = () => Map<string, string>;
let getEditorContent: ContentGetter | null = null;

// Live content overlay: when the editor reports a change we store it here so the 15s tick
// sees the latest content even if React state hasn't flushed yet. Keyed by context (projectId | problemId).
const liveContentByContext = new Map<string, Map<string, string>>();

/** Callback invoked every DIFF_INTERVAL_MS with whether any file had changes this tick. Used for diff-based active/idle accounting. */
export type OnDiffTick = (diffChanged: boolean) => void;
let onDiffTick: OnDiffTick | null = null;

/**
 * Set callback for each 15s tick. Called with true if any diff was emitted this tick, false otherwise.
 */
export function setOnDiffTick(callback: OnDiffTick | null): void {
  onDiffTick = callback;
  diffLog("setOnDiffTick", {
    registered: !!callback,
    source: callback ? "attemptSession.startAttemptSession" : "attemptSession cleanup",
  });
}

// ============================================================================
// Simple Diff Algorithm
// ============================================================================

/**
 * Compute a simple line-based diff between two strings
 * Returns a compact representation of changes
 */
function computeSimpleDiff(oldText: string, newText: string): string {
  if (oldText === newText) return "";
  
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  
  const changes: string[] = [];
  
  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }
  
  // Find common suffix
  let oldSuffix = oldLines.length;
  let newSuffix = newLines.length;
  while (
    oldSuffix > prefixLen &&
    newSuffix > prefixLen &&
    oldLines[oldSuffix - 1] === newLines[newSuffix - 1]
  ) {
    oldSuffix--;
    newSuffix--;
  }
  
  // Record deletions
  for (let i = prefixLen; i < oldSuffix; i++) {
    changes.push(`-${i}:${oldLines[i]}`);
  }
  
  // Record additions
  for (let i = prefixLen; i < newSuffix; i++) {
    changes.push(`+${i}:${newLines[i]}`);
  }
  
  // If diff is too large, just return a summary
  const diffText = changes.join("\n");
  if (diffText.length > CONFIG.MAX_SNAPSHOT_SIZE / 2) {
    return `[LARGE_DIFF: ${changes.length} changes, ${newText.length} chars total]`;
  }
  
  return diffText;
}

// ============================================================================
// Diff Hash Generation
// ============================================================================

/**
 * Generate a deterministic hash (SHA-256 truncated to 32 hex chars) for a diff.
 * Uses Web Crypto API for consistent cross-browser hashing.
 * Input: projectId + fileKey + (diffPatch or fullSnapshot)
 */
async function generateDiffHash(
  projectId: string,
  fileKey: string,
  content: string
): Promise<string> {
  const input = `${projectId}:${fileKey}:${content}`;
  
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    // Truncate to 32 chars (128 bits, same length as MD5)
    return hashHex.slice(0, 32);
  }
  
  // Fallback: simple hash for environments without Web Crypto
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 32);
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Set the context for tracking (project or problem ID)
 */
export function setTrackingContext(context: TrackerContext): void {
  currentContext = context;
  diffLog("setTrackingContext", {
    projectId: context.projectId,
    problemId: context.problemId,
    source: "project/problem panel when editor mounts",
  });
}

/**
 * Set the function that retrieves current editor content
 * This should be called by the editor component
 */
export function setContentGetter(getter: ContentGetter): void {
  getEditorContent = getter;
}

/**
 * Update live content for a file when the editor onChange fires. This ensures the 15s
 * diff tick sees the latest content even if React state is stale when the timer fires.
 * Call from the panel's editor onChange (e.g. handleEditorChange).
 */
export function updateLiveContent(contextKey: string, fileKey: string, content: string): void {
  if (!contextKey) return;
  let map = liveContentByContext.get(contextKey);
  if (!map) {
    map = new Map();
    liveContentByContext.set(contextKey, map);
  }
  map.set(fileKey, content);
}

/**
 * Initialize tracking for a file with its initial content
 */
export function initializeFile(fileKey: string, content: string): void {
  trackedFiles.set(fileKey, {
    lastSnapshot: content,
    lastSnapshotTime: Date.now(),
  });
  diffLog("initializeFile (storage)", {
    fileKey,
    charCount: content.length,
    trackedFileCount: trackedFiles.size,
    source: "checkForChanges when new file appears in getEditorContent()",
  });
}

/**
 * Remove tracking for a file
 */
export function removeFile(fileKey: string): void {
  trackedFiles.delete(fileKey);
}

/**
 * Clear all tracked files
 */
export function clearTrackedFiles(): void {
  trackedFiles.clear();
  currentContext = {};
}

/**
 * Check for changes and log diffs. Returns true if any diff was emitted this tick (content changed in at least one file).
 */
async function checkForChanges(): Promise<boolean> {
  if (!getEditorContent) {
    diffLog("tick (no content getter)", { diffChanged: false, source: "setContentGetter not set" });
    if (onDiffTick) onDiffTick(false);
    return false;
  }

  let diffChanged = false;
  const changedFiles: { fileKey: string; type: string; size: number; diffHash: string; diffPreview?: string }[] = [];
  try {
    const fromGetter = getEditorContent();
    const contextKey = currentContext.projectId ?? currentContext.problemId ?? "";
    const liveMap = contextKey ? liveContentByContext.get(contextKey) : undefined;
    // Merge live overlay (from editor onChange) over getter so we see the latest content
    const currentContent = new Map(fromGetter);
    if (liveMap) {
      Array.from(liveMap.entries()).forEach(([k, v]) => currentContent.set(k, v));
    }
    const entries = Array.from(currentContent.entries());

    for (const [fileKey, content] of entries) {
      const tracked = trackedFiles.get(fileKey);

      if (!tracked) {
        // New file, initialize it
        initializeFile(fileKey, content);
        diffChanged = true; // New file counts as change
        changedFiles.push({
          fileKey,
          type: "new",
          size: content.length,
          diffHash: "",
          diffPreview: content.slice(0, CONFIG.DIFF_PREVIEW_LENGTH),
        });
        continue;
      }

      // Check if content has changed
      if (content === tracked.lastSnapshot) {
        continue; // No changes
      }

      diffChanged = true;

      // Compute diff
      const diffPatch = computeSimpleDiff(tracked.lastSnapshot, content);

      // Determine whether to send full snapshot or diff
      const shouldSendFull =
        diffPatch.length > content.length * 0.5 || // Diff is > 50% of content
        content.length < 500; // Small files, just send full

      const diffContent = shouldSendFull ? content.slice(0, CONFIG.MAX_SNAPSHOT_SIZE) : diffPatch;

      // Generate deterministic diff hash
      const identifier = currentContext.projectId || currentContext.problemId || "unknown";
      const diffHash = await generateDiffHash(identifier, fileKey, diffContent);

      const diffData: InputDiffData = {
        projectId: currentContext.projectId,
        problemId: currentContext.problemId,
        fileKey,
        charCount: content.length,
        diffHash,
      };

      if (shouldSendFull) {
        diffData.fullSnapshot = diffContent;
      } else {
        diffData.diffPatch = diffContent;
      }

      // Log the diff to action logger (batch telemetry)
      logInputDiff(diffData);

      // Update snapshot (in-memory storage for next tick comparison)
      trackedFiles.set(fileKey, {
        lastSnapshot: content,
        lastSnapshotTime: Date.now(),
      });

      const size = shouldSendFull ? (diffData.fullSnapshot?.length ?? 0) : (diffData.diffPatch?.length ?? 0);
      changedFiles.push({
        fileKey,
        type: shouldSendFull ? "full" : "patch",
        size,
        diffHash,
        diffPreview: diffContent.slice(0, CONFIG.DIFF_PREVIEW_LENGTH),
      });
    }

    diffLog("tick (diff check)", {
      diffChanged,
      filesChecked: entries.length,
      filesChanged: changedFiles.length,
      changedFiles,
      context: { projectId: currentContext.projectId, problemId: currentContext.problemId },
      source: "15s interval, getEditorContent()",
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Error checking for changes:`, error);
    diffLog("tick error", { err: error });
  }

  if (onDiffTick) onDiffTick(diffChanged);
  return diffChanged;
}

/**
 * Get current editor content for a context (projectId or problemId).
 * Merges getter content with live overlay. Used by session artifact to get finalCode
 * when actionLogger has no last-known state, and to compute squashedDiffs.
 */
export function getCurrentContentForContext(contextKey: string): Record<string, string> | null {
  if (!getEditorContent || !contextKey) return null;
  const fromGetter = getEditorContent();
  const liveMap = liveContentByContext.get(contextKey);
  const merged = new Map(fromGetter);
  if (liveMap) {
    liveMap.forEach((v, k) => merged.set(k, v));
  }
  if (merged.size === 0) return null;
  return Object.fromEntries(merged);
}

/**
 * Compute squashed diffs from initial to current content (one diff per file).
 * Used by session artifact to include per-file session deltas.
 */
export function getSquashedDiffs(
  initial: Record<string, string>,
  current: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fileKey, newText] of Object.entries(current)) {
    const oldText = initial[fileKey] ?? "";
    const diff = computeSimpleDiff(oldText, newText);
    if (diff) out[fileKey] = diff;
  }
  return out;
}

/**
 * Force an immediate diff check (e.g., before navigation).
 * Returns a promise that resolves to true if any diff was emitted.
 */
export function forceCheck(): Promise<boolean> {
  return checkForChanges();
}

// ============================================================================
// Initialization
// ============================================================================

let isInitialized = false;

/**
 * Start the diff tracking interval
 */
export function startDiffTracking(): void {
  if (typeof window === "undefined") return;
  if (isInitialized) return;

  isInitialized = true;
  diffTimer = setInterval(checkForChanges, CONFIG.DIFF_INTERVAL_MS);
  diffLog("startDiffTracking", {
    intervalMs: CONFIG.DIFF_INTERVAL_MS,
    source: "project/problem panel when editor mounts",
  });
}

/**
 * Stop the diff tracking interval
 */
export function stopDiffTracking(): void {
  if (diffTimer) {
    clearInterval(diffTimer);
    diffTimer = null;
  }
  isInitialized = false;
  diffLog("stopDiffTracking", { source: "panel unmount" });
}

/**
 * Cleanup all tracking state
 */
export function cleanupDiffTracking(): void {
  const hadFiles = trackedFiles.size;
  stopDiffTracking();
  clearTrackedFiles();
  getEditorContent = null;
  liveContentByContext.clear();
  diffLog("cleanupDiffTracking", { hadTrackedFiles: hadFiles });
}
