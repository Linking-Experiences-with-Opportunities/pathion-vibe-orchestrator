/**
 * Action Logger - Core service for tracking user actions
 *
 * Features:
 * - Buffers events in memory
 * - Flushes to backend every 90 seconds
 * - Flushes on page unload
 * - Validates event types
 *
 * Session model: attempt_session_start / attempt_session_end and Session
 * Artifacts are the canonical representation for metrics (see
 * .cursor/plans/shared_instrumentation_and_metrics_506970d1.plan.md).
 * session_start / session_resume (30min global) are kept for batch packet
 * identity only.
 */

import { fetchWithAuth } from "./fetchWithAuth";
import { isApiConfigured } from "./apiConfig";
import { detectBrowser } from "./utils/browserDetection";
import { cacheEvents, drainCachedEvents, getCachedEventCount, cacheCompressedBundle, drainCompressedBundles } from "./eventCacheDB";
import { compressEvents, type CompressedBundle } from "./aiCompressor";

// ============================================================================
// Types
// ============================================================================

export type ActionEventType =
  // Tier 1 - Essential
  | "page_enter"
  | "page_exit"
  | "input_diff"
  | "run_code_click"
  | "run_test_case_click"
  | "submit_click"
  | "button_click"
  | "session_start"
  | "session_resume"
  // Tier 2 - High Value
  | "code_copy"
  | "code_paste"
  | "code_reset"
  | "test_case_expand"
  | "lesson_start"
  | "lesson_complete"
  | "tab_focus"
  | "tab_blur"
  | "attempt_session_start"
  | "attempt_session_end";

export interface InputDiffData {
  projectId?: string;
  problemId?: string;
  fileKey?: string;
  diffPatch?: string;
  fullSnapshot?: string;
  charCount?: number;
  diffHash?: string;  // SHA-256 truncated to 32 hex chars, for deterministic identification
}

export interface ActionEvent {
  type: ActionEventType;
  target?: string;
  metadata?: Record<string, unknown>;
  diff?: InputDiffData;
  timestamp: number;
}

interface ActionBatchPayload {
  events: ActionEvent[];
  sessionId: string;
  packetId: string;       // Client-generated UUID for idempotent delivery
}

interface ActionBatchResponse {
  status: string;
  received: number;
  inserted: number;
}

// ============================================================================
// Connection State
// ============================================================================

type ConnectionState = "online" | "offline" | "degraded";
let connectionState: ConnectionState = typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline";
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Generate a UUID v4 for packet identification
 */
function generatePacketId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Get current connection state */
export function getConnectionState(): ConnectionState {
  return connectionState;
}

// ============================================================================
// Replication Stats
// ============================================================================

const replicationStats = {
  totalFlushed: 0,
  totalDropped: 0,
  totalRetries: 0,
  totalCompressedUploaded: 0,
  lastFlushTime: 0,
  lastFlushStatus: "none" as "none" | "success" | "error",
};

/** Get replication stats (exposed via actionLogger.stats()) */
export function getReplicationStats() {
  return { ...replicationStats };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Logging levels:
 * - "off"     : No console logging
 * - "minimal" : Only flush success/error (default in production)
 * - "normal"  : Events + flush status (default in development)
 * - "verbose" : Full metadata, diffs, buffer contents
 */
type LogLevel = "off" | "minimal" | "normal" | "verbose";

// Check for env var override: NEXT_PUBLIC_ACTION_LOGGER_LOG_LEVEL
// Valid values: "off", "minimal", "normal", "verbose"
function getInitialLogLevel(): LogLevel {
  if (typeof window === "undefined") return "off";
  
  // Check for env var override
  const envLevel = process.env.NEXT_PUBLIC_ACTION_LOGGER_LOG_LEVEL as LogLevel;
  if (envLevel && ["off", "minimal", "normal", "verbose"].includes(envLevel)) {
    return envLevel;
  }
  
  // Default: "normal" in dev, "minimal" in production
  return process.env.NODE_ENV === "development" ? "normal" : "minimal";
}

const CONFIG = {
  FLUSH_INTERVAL_MS: 90 * 1000, // 90 seconds
  MAX_BUFFER_SIZE: 100,         // Max events before forced flush
  MIN_FLUSH_SIZE: 1,            // Minimum events to trigger a flush
  RETRY_DELAY_MS: 5000,         // Retry delay on failure
  MAX_RETRIES: 3,               // Max retry attempts
};

// ============================================================================
// Debug Logging
// ============================================================================

// Current log level - can be changed at runtime
let currentLogLevel: LogLevel = getInitialLogLevel();

// Console styling for different event categories
const LOG_STYLES = {
  // Event type colors
  page_enter: "color: #4CAF50; font-weight: bold",      // Green
  page_exit: "color: #F44336; font-weight: bold",       // Red
  button_click: "color: #2196F3; font-weight: bold",    // Blue
  run_code_click: "color: #FF9800; font-weight: bold",  // Orange
  run_test_case_click: "color: #FF5722; font-weight: bold", // Deep Orange
  submit_click: "color: #9C27B0; font-weight: bold",    // Purple
  code_copy: "color: #00BCD4; font-weight: bold",       // Cyan
  code_paste: "color: #00BCD4; font-weight: bold",      // Cyan
  code_reset: "color: #795548; font-weight: bold",      // Brown
  input_diff: "color: #607D8B; font-weight: bold",      // Gray
  test_case_expand: "color: #3F51B5; font-weight: bold", // Indigo
  lesson_start: "color: #8BC34A; font-weight: bold",    // Light Green
  lesson_complete: "color: #CDDC39; font-weight: bold", // Lime
  tab_focus: "color: #009688; font-weight: bold",       // Teal
  tab_blur: "color: #9E9E9E; font-weight: bold",        // Gray
  session_start: "color: #E91E63; font-weight: bold",   // Pink
  session_resume: "color: #E91E63; font-weight: bold",  // Pink
  attempt_session_start: "color: #E91E63; font-weight: bold",  // Pink
  attempt_session_end: "color: #E91E63; font-weight: bold",   // Pink
  // System messages
  system: "color: #9E9E9E; font-style: italic",
  success: "color: #4CAF50; font-weight: bold",
  warning: "color: #FF9800; font-weight: bold",
  error: "color: #F44336; font-weight: bold",
};

/**
 * Set the logging level
 * Call from browser console: actionLogger.setLogLevel("verbose")
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
  console.log(
    `%c[ActionLogger] 📊 Log level set to: ${level.toUpperCase()}`,
    LOG_STYLES.success
  );
  if (level !== "off") {
    console.log(
      "%c[ActionLogger] Buffer size: " + eventBuffer.length + " events",
      LOG_STYLES.system
    );
  }
}

/**
 * Enable verbose console logging (convenience alias)
 * Call this from browser console: actionLogger.enableVerbose()
 */
export function enableVerboseLogging(): void {
  setLogLevel("verbose");
}

/**
 * Disable console logging
 */
export function disableLogging(): void {
  setLogLevel("off");
}

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Check if at least minimal logging is enabled
 */
function shouldLog(requiredLevel: LogLevel): boolean {
  const levels: LogLevel[] = ["off", "minimal", "normal", "verbose"];
  const currentIdx = levels.indexOf(currentLogLevel);
  const requiredIdx = levels.indexOf(requiredLevel);
  return currentIdx >= requiredIdx;
}

/**
 * Log to console with styling based on log level
 * @param minLevel - minimum log level required to show this message
 */
function debugLog(
  message: string,
  style: string = LOG_STYLES.system,
  data?: unknown,
  minLevel: LogLevel = "normal"
): void {
  if (!shouldLog(minLevel)) return;
  
  if (data !== undefined) {
    console.log(`%c${message}`, style, data);
  } else {
    console.log(`%c${message}`, style);
  }
}

// Low-value events that only log at verbose level
const VERBOSE_ONLY_EVENTS = new Set<ActionEventType>([
  "tab_focus",
  "tab_blur",
  "session_resume",
]);

/**
 * Log event with detailed formatting
 * - High-value events log at "normal" level
 * - Low-value events (tab focus/blur) log at "verbose" level only
 */
function logEventToConsole(event: ActionEvent): void {
  // Low-value events require verbose level
  const requiredLevel = VERBOSE_ONLY_EVENTS.has(event.type) ? "verbose" : "normal";
  if (!shouldLog(requiredLevel)) return;
  
  const style = LOG_STYLES[event.type] || LOG_STYLES.system;
  const timestamp = new Date(event.timestamp).toLocaleTimeString();
  const bufferInfo = `[${eventBuffer.length}/${CONFIG.MAX_BUFFER_SIZE}]`;
  
  // Build the log message
  let message = `[ActionLogger] ${bufferInfo} 📝 ${event.type}`;
  if (event.target) {
    message += ` → ${event.target}`;
  }
  message += ` @ ${timestamp}`;
  
  console.log(`%c${message}`, style);
  
  // Log metadata if verbose level and present
  if (shouldLog("verbose") && event.metadata && Object.keys(event.metadata).length > 0) {
    // Filter out browser info for cleaner output
    const { browser, os, deviceType, url, ...relevantMeta } = event.metadata as Record<string, unknown>;
    if (Object.keys(relevantMeta).length > 0) {
      console.log("%c  └─ metadata:", LOG_STYLES.system, relevantMeta);
    }
  }
  
  // Log diff info if verbose level and present
  if (shouldLog("verbose") && event.diff) {
    console.log("%c  └─ diff:", LOG_STYLES.system, {
      projectId: event.diff.projectId,
      problemId: event.diff.problemId,
      fileKey: event.diff.fileKey,
      charCount: event.diff.charCount,
      hasPatch: !!event.diff.diffPatch,
      hasSnapshot: !!event.diff.fullSnapshot,
    });
  }
}

/**
 * Print current buffer status to console
 */
export function printBufferStatus(): void {
  const sessionAge = sessionStartTime 
    ? Math.round((Date.now() - sessionStartTime) / 1000) 
    : 0;
  
  console.log("%c╔══════════════════════════════════════════╗", LOG_STYLES.system);
  console.log("%c║       ACTION LOGGER STATUS               ║", LOG_STYLES.success);
  console.log("%c╠══════════════════════════════════════════╣", LOG_STYLES.system);
  console.log(`%c║ Session ID: ${sessionId?.slice(0, 20) || "N/A"}...`, LOG_STYLES.system);
  console.log(`%c║ Session Age: ${sessionAge}s`, LOG_STYLES.system);
  console.log(`%c║ Buffer Size: ${eventBuffer.length}/${CONFIG.MAX_BUFFER_SIZE}`, LOG_STYLES.system);
  console.log(`%c║ Flush Interval: ${CONFIG.FLUSH_INTERVAL_MS / 1000}s`, LOG_STYLES.system);
  console.log(`%c║ Log Level: ${currentLogLevel.toUpperCase()}`, LOG_STYLES.system);
  console.log(`%c║ Connection: ${connectionState.toUpperCase()}`, LOG_STYLES.system);
  console.log(`%c║ Total Flushed: ${replicationStats.totalFlushed}`, LOG_STYLES.system);
  console.log(`%c║ Total Retries: ${replicationStats.totalRetries}`, LOG_STYLES.system);
  console.log(`%c║ Initialized: ${isInitialized ? "YES" : "NO"}`, LOG_STYLES.system);
  console.log("%c╚══════════════════════════════════════════╝", LOG_STYLES.system);
  
  if (eventBuffer.length > 0 && shouldLog("verbose")) {
    console.log("%c\nBuffered Events:", LOG_STYLES.system);
    eventBuffer.forEach((event, idx) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      console.log(`%c  ${idx + 1}. ${event.type}${event.target ? ` → ${event.target}` : ""} @ ${time}`, 
        LOG_STYLES[event.type] || LOG_STYLES.system);
    });
  }
}

/**
 * Expose functions to window for console access
 */
if (typeof window !== "undefined") {
  (window as any).actionLogger = {
    // Log level controls
    setLogLevel,
    getLogLevel,
    enableVerbose: enableVerboseLogging,
    disable: disableLogging,
    // Convenience aliases
    normal: () => setLogLevel("normal"),
    minimal: () => setLogLevel("minimal"),
    verbose: () => setLogLevel("verbose"),
    off: () => setLogLevel("off"),
    // Status and data
    status: printBufferStatus,
    stats: getReplicationStats,
    connection: getConnectionState,
    getBuffer: () => [...eventBuffer],
    getBufferSize,
    forceFlush,
    // Help
    help: () => {
      console.log("%c╔══════════════════════════════════════════╗", LOG_STYLES.system);
      console.log("%c║       ACTION LOGGER COMMANDS             ║", LOG_STYLES.success);
      console.log("%c╠══════════════════════════════════════════╣", LOG_STYLES.system);
      console.log("%c║ actionLogger.off()        - Disable logs ", LOG_STYLES.system);
      console.log("%c║ actionLogger.minimal()    - Flush only   ", LOG_STYLES.system);
      console.log("%c║ actionLogger.normal()     - Events+flush ", LOG_STYLES.system);
      console.log("%c║ actionLogger.verbose()    - Full details ", LOG_STYLES.system);
      console.log("%c║ actionLogger.status()     - Show buffer  ", LOG_STYLES.system);
      console.log("%c║ actionLogger.stats()      - Repl. stats  ", LOG_STYLES.system);
      console.log("%c║ actionLogger.connection() - Conn. state  ", LOG_STYLES.system);
      console.log("%c║ actionLogger.forceFlush() - Send now     ", LOG_STYLES.system);
      console.log("%c╚══════════════════════════════════════════╝", LOG_STYLES.system);
    },
  };
}

// ============================================================================
// Session Management
// ============================================================================

let sessionId: string | null = null;
let sessionStartTime: number | null = null;

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  
  if (!sessionId) {
    // Try to recover existing session
    sessionId = sessionStorage.getItem("action_session_id");
    const storedStartTime = sessionStorage.getItem("action_session_start");
    
    if (sessionId && storedStartTime) {
      sessionStartTime = parseInt(storedStartTime, 10);
      // Check if session is still valid (less than 30 minutes old)
      const sessionAge = Date.now() - sessionStartTime;
      if (sessionAge > 30 * 60 * 1000) {
        // Session expired, create new one
        sessionId = null;
      }
    }
    
    if (!sessionId) {
      // Create new session
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStartTime = Date.now();
      sessionStorage.setItem("action_session_id", sessionId);
      sessionStorage.setItem("action_session_start", sessionStartTime.toString());
      
      // Log session start
      logAction({ type: "session_start", timestamp: Date.now() });
    } else {
      // Resuming existing session
      logAction({ type: "session_resume", timestamp: Date.now() });
    }
  }
  
  return sessionId;
}

// ============================================================================
// Event Buffer
// ============================================================================

let eventBuffer: ActionEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let isFlushInProgress = false;
let retryCount = 0;

// ============================================================================
// Debounce Configuration
// ============================================================================

/**
 * Per-type debounce thresholds in milliseconds.
 * Events within the debounce window with the same type AND target are collapsed.
 * 0 = no debounce (every event passes through).
 */
const DEBOUNCE_CONFIG: Partial<Record<ActionEventType, number>> = {
  tab_focus: 1000,
  tab_blur: 1000,
  button_click: 300,
  page_enter: 500,
  page_exit: 500,
  code_copy: 500,
  code_paste: 500,
  test_case_expand: 200,
  // input_diff: 0 -- already interval-gated at 15s
  // run_code_click: 0 -- always pass through
  // submit_click: 0 -- always pass through
  // session_start: 0 -- always pass through
  // session_resume: 0 -- always pass through
  // lesson_start: 0 -- always pass through
  // lesson_complete: 0 -- always pass through
  // code_reset: 0 -- always pass through
};

/** Tracks the last emitted event per type for debounce comparison */
const lastEventByType = new Map<ActionEventType, { timestamp: number; target?: string }>();

/**
 * Check if an event should be debounced (skipped).
 * Returns true if the event is a duplicate within the debounce window.
 */
function shouldDebounce(type: ActionEventType, target?: string, timestamp?: number): boolean {
  const threshold = DEBOUNCE_CONFIG[type];
  if (!threshold) return false; // No debounce for this type

  const last = lastEventByType.get(type);
  if (!last) return false; // First event of this type

  const now = timestamp ?? Date.now();
  const timeSinceLast = now - last.timestamp;

  // Only debounce if within window AND same target (or both have no target)
  if (timeSinceLast < threshold && last.target === target) {
    return true;
  }

  return false;
}

/**
 * Record an event emission for debounce tracking
 */
function recordEventEmission(type: ActionEventType, target?: string, timestamp?: number): void {
  lastEventByType.set(type, { timestamp: timestamp ?? Date.now(), target });
}

// ============================================================================
// Last Known State (for submission reconstruction)
// ============================================================================

/**
 * Tracks the last known code state per project/problem.
 * Used to enrich submit_click and run_code_click events with code context
 * when the submittedCode isn't explicitly provided.
 */
interface LastKnownCodeState {
  code: Record<string, string>;  // fileKey -> code content
  lastDiffHash: string;
  lastPacketId: string;
  updatedAt: number;
}

const lastKnownState = new Map<string, LastKnownCodeState>();

/**
 * Update the last known state from input_diff events
 */
function updateLastKnownState(event: ActionEvent): void {
  if (event.type !== "input_diff" || !event.diff) return;
  
  const key = event.diff.projectId || event.diff.problemId;
  if (!key) return;
  
  const state = lastKnownState.get(key) || { code: {}, lastDiffHash: "", lastPacketId: "", updatedAt: 0 };
  
  // Update file content from snapshot
  if (event.diff.fullSnapshot && event.diff.fileKey) {
    state.code[event.diff.fileKey] = event.diff.fullSnapshot;
  }
  
  if (event.diff.diffHash) {
    state.lastDiffHash = event.diff.diffHash;
  }
  
  state.updatedAt = event.timestamp;
  lastKnownState.set(key, state);
}

/**
 * Get the last known code state for a project or problem (from input_diff events).
 * Used by session artifact to include finalCode in the upload.
 */
export function getLastKnownCode(projectOrProblemKey: string): Record<string, string> | null {
  const state = lastKnownState.get(projectOrProblemKey);
  if (!state || Object.keys(state.code).length === 0) return null;
  return { ...state.code };
}

/**
 * Enrich submission events with last known code state if submittedCode is missing
 */
function enrichSubmissionEvent(event: ActionEvent): void {
  if (event.type !== "submit_click" && event.type !== "run_code_click") return;
  if (!event.metadata) return;
  
  // Already has submitted code? Skip.
  if (event.metadata.submittedCode) return;
  
  const projectId = event.metadata.projectId as string;
  const problemId = event.metadata.problemId as string;
  const key = projectId || problemId;
  if (!key) return;
  
  const state = lastKnownState.get(key);
  if (state && Object.keys(state.code).length > 0) {
    event.metadata.submittedCode = { ...state.code };
    event.metadata.lastDiffHash = state.lastDiffHash;
    debugLog(
      `[ActionLogger] 📎 Enriched ${event.type} with last known code state`,
      LOG_STYLES.system,
      undefined,
      "verbose"
    );
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Log a user action event
 */
export function logAction(event: Omit<ActionEvent, "timestamp"> & { timestamp?: number }): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "test") return;
  
  const now = event.timestamp ?? Date.now();
  
  // Debounce check: skip if duplicate within window
  if (shouldDebounce(event.type, event.target, now)) {
    debugLog(
      `[ActionLogger] ⏭ Debounced: ${event.type}${event.target ? ` → ${event.target}` : ""}`,
      LOG_STYLES.system,
      undefined,
      "verbose"
    );
    // Update timestamp of last matching event in buffer instead of adding new
    for (let i = eventBuffer.length - 1; i >= 0; i--) {
      if (eventBuffer[i].type === event.type && eventBuffer[i].target === event.target) {
        eventBuffer[i].timestamp = now;
        break;
      }
    }
    return;
  }
  
  const fullEvent: ActionEvent = {
    ...event,
    timestamp: now,
  };
  
  // Add browser info to metadata if not present
  if (!fullEvent.metadata?.browser) {
    const browserInfo = detectBrowser();
    fullEvent.metadata = {
      ...fullEvent.metadata,
      browser: browserInfo?.browser,
      os: browserInfo?.os,
      deviceType: browserInfo?.deviceType,
      url: window.location.href,
    };
  }
  
  // Track last known state from diff events
  updateLastKnownState(fullEvent);
  
  // Enrich submission events with last known code if missing
  enrichSubmissionEvent(fullEvent);
  
  // Record for debounce tracking
  recordEventEmission(event.type, event.target, now);
  
  eventBuffer.push(fullEvent);
  
  // Log to console with detailed formatting
  logEventToConsole(fullEvent);
  
  // Handle buffer pressure
  if (eventBuffer.length >= CONFIG.MAX_BUFFER_SIZE) {
    if (connectionState === "offline" || connectionState === "degraded") {
      // Offline with full buffer: attempt AI compression
      debugLog(
        `[ActionLogger] 🤖 Buffer full while offline - attempting AI compression...`,
        LOG_STYLES.warning,
        undefined,
        "minimal"
      );
      attemptCompression();
    } else {
      debugLog(`[ActionLogger] ⚠️ Buffer full! Force flushing ${eventBuffer.length} events...`, LOG_STYLES.warning);
      flushEvents();
    }
  } else if (connectionState === "offline" && eventBuffer.length >= Math.floor(CONFIG.MAX_BUFFER_SIZE * 0.8)) {
    // 80% capacity while offline: proactive compression
    debugLog(
      `[ActionLogger] 🤖 Buffer at 80% while offline - proactive compression`,
      LOG_STYLES.system,
      undefined,
      "normal"
    );
    attemptCompression();
  }
}

/**
 * Attempt to compress buffered events via AI and store as compressed bundle
 */
async function attemptCompression(): Promise<void> {
  if (eventBuffer.length === 0) return;
  
  try {
    const sid = sessionId || "unknown";
    const bundle = await compressEvents([...eventBuffer], sid);
    debugLog(
      `[ActionLogger] ✅ Compressed ${bundle.eventCount} events into bundle [${bundle.id.slice(0, 8)}]`,
      LOG_STYLES.success,
      undefined,
      "minimal"
    );
    // Store compressed bundle in IndexedDB
    await cacheCompressedBundle(bundle);
    eventBuffer = []; // Clear raw events - they're now compressed
  } catch (err) {
    debugLog(`[ActionLogger] ❌ Compression error (Nano unavailable or prompt failed): ${err}`, LOG_STYLES.error);
    // Nano not available or failed — cache raw events instead
    await cacheEvents([...eventBuffer]);
    eventBuffer = [];
  }
}

/**
 * Convenience function for logging button clicks
 */
export function logButtonClick(target: string, metadata?: Record<string, unknown>): void {
  logAction({
    type: "button_click",
    target,
    metadata,
  });
}

/**
 * Convenience function for logging page navigation
 */
export function logPageEnter(route: string, metadata?: Record<string, unknown>): void {
  logAction({
    type: "page_enter",
    target: route,
    metadata: {
      ...metadata,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
    },
  });
}

export function logPageExit(route: string, timeOnPage: number, metadata?: Record<string, unknown>): void {
  logAction({
    type: "page_exit",
    target: route,
    metadata: {
      ...metadata,
      timeOnPage,
    },
  });
}

/**
 * Log input diff (code changes)
 */
export function logInputDiff(diff: InputDiffData): void {
  logAction({
    type: "input_diff",
    diff,
  });
}

/**
 * Log code editor actions
 */
export function logCodeAction(
  type: "run_code_click" | "run_test_case_click" | "submit_click" | "code_copy" | "code_paste" | "code_reset",
  target: string,
  metadata?: Record<string, unknown>
): void {
  logAction({ type, target, metadata });
}

/**
 * Log tab visibility changes
 */
export function logTabVisibility(visible: boolean): void {
  logAction({
    type: visible ? "tab_focus" : "tab_blur",
  });
}

/**
 * Log test case expansion
 */
export function logTestCaseExpand(testIndex: number, projectId?: string, problemId?: string): void {
  logAction({
    type: "test_case_expand",
    target: `test_${testIndex}`,
    metadata: { testIndex, projectId, problemId },
  });
}

/**
 * Log lesson progress
 */
export function logLessonAction(
  type: "lesson_start" | "lesson_complete",
  moduleId: string,
  activityId: string,
  metadata?: Record<string, unknown>
): void {
  logAction({
    type,
    target: `${moduleId}/${activityId}`,
    metadata: { moduleId, activityId, ...metadata },
  });
}


// ============================================================================
// Flush Logic
// ============================================================================

/**
 * Flush events to the backend
 * Connection-aware: if offline, caches to IndexedDB instead.
 */
async function flushEvents(): Promise<void> {
  if (isFlushInProgress) return;
  if (eventBuffer.length < CONFIG.MIN_FLUSH_SIZE) return;
  
  // If offline, cache to IndexedDB instead of sending
  if (connectionState === "offline") {
    debugLog(
      `[ActionLogger] 📴 Offline - caching ${eventBuffer.length} events to IndexedDB`,
      LOG_STYLES.warning,
      undefined,
      "minimal"
    );
    await cacheEvents([...eventBuffer]);
    eventBuffer = [];
    return;
  }
  
  if (!isApiConfigured()) {
    debugLog("[ActionLogger] ⚠️ API not configured, skipping flush", LOG_STYLES.warning);
    return;
  }
  
  isFlushInProgress = true;
  const eventsToSend = [...eventBuffer];
  eventBuffer = []; // Clear buffer optimistically
  const packetId = generatePacketId();
  
  try {
    const payload: ActionBatchPayload = {
      events: eventsToSend,
      sessionId: getSessionId(),
      packetId,
    };
    
    debugLog(
      `[ActionLogger] 🚀 Flushing ${eventsToSend.length} events [${packetId.slice(0, 8)}]...`,
      LOG_STYLES.system,
      undefined,
      "minimal"
    );
    
    // Log event types being sent if verbose level
    if (shouldLog("verbose")) {
      const eventTypes = eventsToSend.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log("%c  └─ Event breakdown:", LOG_STYLES.system, eventTypes);
    }
    
    const response = await fetchWithAuth("/telemetry/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`Flush failed: ${response.status}`);
    }
    
    const result: ActionBatchResponse = await response.json();
    
    // Update replication stats
    replicationStats.totalFlushed += result.inserted;
    replicationStats.lastFlushTime = Date.now();
    replicationStats.lastFlushStatus = "success";
    
    debugLog(
      `[ActionLogger] ✅ Flush complete: ${result.inserted}/${result.received} events [${packetId.slice(0, 8)}]`,
      LOG_STYLES.success,
      undefined,
      "minimal"
    );
    
    retryCount = 0; // Reset retry count on success
    
  } catch (error) {
    replicationStats.lastFlushStatus = "error";
    
    debugLog(
      `[ActionLogger] ❌ Flush error: ${error instanceof Error ? error.message : "Unknown error"}`,
      LOG_STYLES.error,
      undefined,
      "minimal"
    );
    
    // Re-add events to buffer for retry
    eventBuffer = [...eventsToSend, ...eventBuffer];
    
    // Implement exponential backoff
    retryCount++;
    replicationStats.totalRetries++;
    
    if (retryCount < CONFIG.MAX_RETRIES) {
      const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount - 1);
      debugLog(
        `[ActionLogger] 🔄 Retry ${retryCount}/${CONFIG.MAX_RETRIES} in ${delay}ms...`,
        LOG_STYLES.warning
      );
      setTimeout(flushEvents, delay);
    } else {
      // Max retries reached, persist to IndexedDB before dropping
      debugLog(
        `[ActionLogger] ⛔ Max retries reached, caching to IndexedDB`,
        LOG_STYLES.error,
        undefined,
        "minimal"
      );
      await cacheEvents([...eventBuffer]);
      const dropped = Math.max(0, eventBuffer.length - CONFIG.MAX_BUFFER_SIZE);
      if (dropped > 0) {
        replicationStats.totalDropped += dropped;
      }
      eventBuffer = [];
      retryCount = 0;
    }
  } finally {
    isFlushInProgress = false;
  }
}

// Throttle tracking for forceFlush
let lastForceFlushTime = 0;
const FORCE_FLUSH_THROTTLE_MS = 2000; // Minimum 2 seconds between force flushes

/**
 * Force an immediate flush (e.g., on page unload)
 * Throttled to prevent rapid repeated flushes
 */
export async function forceFlush(): Promise<void> {
  if (eventBuffer.length === 0) return;
  
  const now = Date.now();
  const timeSinceLastFlush = now - lastForceFlushTime;
  
  // Throttle rapid force flush requests
  if (timeSinceLastFlush < FORCE_FLUSH_THROTTLE_MS) {
    debugLog(
      `[ActionLogger] ⏳ Force flush throttled (${Math.round((FORCE_FLUSH_THROTTLE_MS - timeSinceLastFlush) / 1000)}s cooldown)`,
      LOG_STYLES.system,
      undefined,
      "verbose"
    );
    return;
  }
  
  lastForceFlushTime = now;
  
  debugLog(
    `[ActionLogger] 💨 Force flush (${eventBuffer.length} events)`,
    LOG_STYLES.warning,
    undefined,
    "minimal" // Show even in minimal mode
  );
  
  try {
    await flushEvents();
  } catch {
    // If flush fails, events will be in buffer for retry
    debugLog("[ActionLogger] ⚠️ Force flush failed", LOG_STYLES.warning);
  }
}

// ============================================================================
// Initialization
// ============================================================================

let isInitialized = false;

/**
 * Initialize the action logger
 * Sets up the flush interval, connection tracking, and page unload handler
 */
export function initActionLogger(): void {
  if (typeof window === "undefined") return;
  if (isInitialized) return;
  
  isInitialized = true;
  
  // Start flush interval
  flushTimer = setInterval(flushEvents, CONFIG.FLUSH_INTERVAL_MS);
  
  // --- Connection health tracking ---
  connectionState = navigator.onLine ? "online" : "offline";
  
  window.addEventListener("online", () => {
    connectionState = "online";
    debugLog("[ActionLogger] 🌐 Connection restored", LOG_STYLES.success, undefined, "minimal");
    // Flush after a short delay to let connection stabilize
    setTimeout(async () => {
      // Recover any events cached in IndexedDB while offline
      await recoverCachedEvents();
      flushEvents();
    }, 2000);
  });
  
  window.addEventListener("offline", () => {
    connectionState = "offline";
    debugLog("[ActionLogger] 📴 Connection lost - events will be cached locally", LOG_STYLES.warning, undefined, "minimal");
  });
  
  // Periodic health check (every 60s when online, detect degraded state)
  // Hits the Go backend /health endpoint via fetchWithAuth
  healthCheckTimer = setInterval(async () => {
    if (!navigator.onLine) {
      connectionState = "offline";
      return;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetchWithAuth("/health", { signal: controller.signal, method: "GET" });
      clearTimeout(timeoutId);
      if (response.ok) {
        if (connectionState !== "online") {
          connectionState = "online";
          debugLog("[ActionLogger] 🌐 Health check passed - online", LOG_STYLES.success, undefined, "verbose");
        }
      } else {
        throw new Error(`Health check returned ${response.status}`);
      }
    } catch {
      if (connectionState === "online") {
        connectionState = "degraded";
        debugLog("[ActionLogger] ⚠️ Health check failed - degraded", LOG_STYLES.warning, undefined, "minimal");
      }
    }
  }, 60000);
  
  // Flush on page visibility change (going to background)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      forceFlush();
    }
  });
  
  // Flush on page unload
  window.addEventListener("beforeunload", () => {
    forceFlush();
  });
  
  // Ensure session is initialized
  getSessionId();
  
  // Recover any events cached in IndexedDB from previous sessions
  recoverCachedEvents();
  
  debugLog(
    `[ActionLogger] 🎬 Initialized - Flush: ${CONFIG.FLUSH_INTERVAL_MS / 1000}s | Connection: ${connectionState}`,
    LOG_STYLES.success
  );
  
  // Log instructions for using the logger
  if (shouldLog("normal")) {
    console.log(
      "%c[ActionLogger] 💡 Run `actionLogger.help()` to see all commands",
      LOG_STYLES.system
    );
  }
}

/**
 * Recover events and compressed bundles from IndexedDB
 */
async function recoverCachedEvents(): Promise<void> {
  try {
    // 1. Upload any compressed bundles first
    const bundles = await drainCompressedBundles();
    if (bundles.length > 0) {
      debugLog(
        `[ActionLogger] 📦 Uploading ${bundles.length} compressed bundle(s)`,
        LOG_STYLES.system,
        undefined,
        "minimal"
      );
      for (const bundle of bundles as CompressedBundle[]) {
        await uploadCompressedBundle(bundle);
      }
    }
    
    // 2. Recover raw cached events
    const cachedCount = await getCachedEventCount();
    if (cachedCount === 0) return;
    
    debugLog(
      `[ActionLogger] 🔄 Recovering ${cachedCount} cached events from IndexedDB`,
      LOG_STYLES.system,
      undefined,
      "minimal"
    );
    
    const cached = await drainCachedEvents();
    if (cached.length > 0) {
      // Prepend cached events (they're older)
      eventBuffer = [...(cached as ActionEvent[]), ...eventBuffer];
      debugLog(
        `[ActionLogger] ✅ Recovered ${cached.length} events, buffer now: ${eventBuffer.length}`,
        LOG_STYLES.success,
        undefined,
        "minimal"
      );
    }
  } catch (err) {
    debugLog(
      `[ActionLogger] ⚠️ Failed to recover cached events: ${err}`,
      LOG_STYLES.warning
    );
  }
}

/**
 * Upload a compressed bundle to the backend
 */
async function uploadCompressedBundle(bundle: CompressedBundle): Promise<void> {
  if (!isApiConfigured()) return;
  
  try {
    const payload = {
      events: [], // No raw events
      sessionId: bundle.sessionId,
      packetId: bundle.id,
      compressed: true,
      aiSummary: bundle.summary,
      eventCount: bundle.eventCount,
      eventTypes: bundle.eventTypes,
      timeRange: bundle.timeRange,
    };
    
    const response = await fetchWithAuth("/telemetry/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (response.ok) {
      replicationStats.totalCompressedUploaded++;
      debugLog(
        `[ActionLogger] ✅ Compressed bundle uploaded [${bundle.id.slice(0, 8)}] (${bundle.eventCount} events)`,
        LOG_STYLES.success,
        undefined,
        "minimal"
      );
    }
  } catch (err) {
    debugLog(`[ActionLogger] ❌ Failed to upload compressed bundle: ${err}`, LOG_STYLES.error);
    // Re-cache the bundle for next attempt
    await cacheCompressedBundle(bundle);
  }
}

/**
 * Cleanup the action logger (for testing or unmounting)
 */
export function cleanupActionLogger(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
  isInitialized = false;
}

/**
 * Get current buffer size (for debugging/monitoring)
 */
export function getBufferSize(): number {
  return eventBuffer.length;
}
