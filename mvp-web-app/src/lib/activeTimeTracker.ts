/**
 * Active Time Tracker
 * 
 * Measures actual user engagement time by monitoring mouse, keyboard, scroll,
 * and touch activity. If the user is idle for longer than IDLE_THRESHOLD_MS
 * (default 20 seconds), idle time is NOT counted toward active time.
 * 
 * Usage:
 *   initActiveTimeTracker()          // call once on app init
 *   const mark = markActiveTime()    // snapshot before a timed operation
 *   ...                              // user works (or walks away)
 *   getActiveTimeSince(mark)         // only the engaged milliseconds
 * 
 * This prevents speed scores from being wrecked when a user steps away for
 * coffee mid-problem and comes back to a "17 hour" time-on-task.
 */

// ============================================================================
// Configuration
// ============================================================================

/** How long without interaction before the user is considered idle */
const IDLE_THRESHOLD_MS = 20_000; // 20 seconds

/** How often we accumulate active time */
const TICK_INTERVAL_MS = 1_000; // 1 second

/** Minimum gap between processing raw DOM activity events (perf guard) */
const ACTIVITY_THROTTLE_MS = 150;

/** DOM events that count as "user is active" */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "keypress",
  "scroll",
  "touchstart",
  "click",
] as const;

// ============================================================================
// State
// ============================================================================

/** performance.now() of the last detected user interaction */
let lastActivityAt = 0;

/** Running total of active milliseconds since init */
let cumulativeActiveMs = 0;

/** performance.now() of the last tick */
let lastTickAt = 0;

/** Throttle guard for raw DOM events */
let lastHandledAt = 0;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Throttled handler attached to every ACTIVITY_EVENT.
 * Just stamps lastActivityAt so the tick loop knows the user is present.
 */
function handleActivity(): void {
  const now = performance.now();
  if (now - lastHandledAt < ACTIVITY_THROTTLE_MS) return;
  lastHandledAt = now;
  lastActivityAt = now;
}

/**
 * Called every TICK_INTERVAL_MS.
 * If the user interacted within the idle threshold, we credit that tick
 * toward active time.
 */
function tick(): void {
  const now = performance.now();
  if (lastActivityAt > 0 && (now - lastActivityAt) < IDLE_THRESHOLD_MS) {
    // User is (or was recently) active — credit time since last tick
    const elapsed = now - lastTickAt;
    // Clamp to a sane max to prevent jumps if the tab was suspended
    cumulativeActiveMs += Math.min(elapsed, TICK_INTERVAL_MS + 200);
  }
  lastTickAt = now;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialise the tracker. Safe to call multiple times (no-ops after first).
 * Should be called once at app startup (e.g. in ActionTrackingProvider).
 */
export function initActiveTimeTracker(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const now = performance.now();
  lastTickAt = now;
  lastActivityAt = now; // Assume active on init

  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, handleActivity, { passive: true, capture: true });
  }

  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
}

/**
 * Tear down listeners and timer. Call on app unmount / cleanup.
 */
export function cleanupActiveTimeTracker(): void {
  if (!initialized) return;

  for (const evt of ACTIVITY_EVENTS) {
    window.removeEventListener(evt, handleActivity, { capture: true } as EventListenerOptions);
  }

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  initialized = false;
}

/**
 * Snapshot the current cumulative active time.
 * Use the returned value later with `getActiveTimeSince()` to measure
 * how much *active* time elapsed between the two calls.
 */
export function markActiveTime(): number {
  tick(); // Force an up-to-date accumulation
  return cumulativeActiveMs;
}

/**
 * Return the number of active milliseconds elapsed since the given mark.
 * Idle gaps (>20 s without interaction) are excluded.
 */
export function getActiveTimeSince(mark: number): number {
  tick(); // Force an up-to-date accumulation
  return Math.max(0, cumulativeActiveMs - mark);
}

/**
 * Total active milliseconds since the tracker was initialised.
 */
export function getTotalActiveTime(): number {
  tick();
  return cumulativeActiveMs;
}

/**
 * Whether the user is currently considered idle.
 */
export function isUserIdle(): boolean {
  if (lastActivityAt === 0) return true;
  return (performance.now() - lastActivityAt) >= IDLE_THRESHOLD_MS;
}
