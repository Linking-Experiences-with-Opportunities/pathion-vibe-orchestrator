import { API_ORIGIN, isApiConfigured } from "./apiConfig";
import { fetchWithAuth } from "./fetchWithAuth";
import { detectBrowser } from "./utils/browserDetection";

interface TelemetryEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp?: number;
  sessionId?: string;
}

let sessionId: string | null = null;
let userId: string | null = null;

// Generate or get session ID
function getSessionId(): string {
  if (!sessionId && typeof window !== "undefined") {
    sessionId = sessionStorage.getItem("telemetry_session_id");
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem("telemetry_session_id", sessionId);
    }
  }
  return sessionId || "unknown";
}

// Set user ID for telemetry
export function setTelemetryUserId(id: string) {
  userId = id;
}

// Initialize telemetry with session
export function initializeTelemetry(session: any) {
  if (session?.user?.id) {
    console.log("[Telemetry] Initializing with User UUID:", session.user.id);
    userId = session.user.id;
  } else if (session?.user?.email) {
    console.warn("[Telemetry] Initializing with Email (Legacy Fallback):", session.user.email);
    // We prefer UUID, but if for some reason it's missing (unlikely with Supabase), fall back to email
    // This should ideally be avoided per the new plan, but safety first for untyped session objects
    userId = session.user.email;
  }
}

/** Details surfaced when a telemetry call fails. */
export interface TelemetryError {
  event: string;
  message: string;
  status?: number;
}

/** Optional config for trackTelemetry. */
export interface TrackTelemetryOptions {
  /** Called when the backgrounded POST fails (network error or non-2xx). */
  onError?: (error: TelemetryError) => void;
}

// Track telemetry event
export async function trackTelemetry(
  event: string,
  properties?: Record<string, any>,
  options?: TrackTelemetryOptions
): Promise<void> {
  // Skip telemetry in test environments
  if (process.env.NODE_ENV === "test") return;

  if (!isApiConfigured()) {
    const msg = "API origin not configured, skipping telemetry";
    console.warn(msg);
    options?.onError?.({ event, message: msg });
    return;
  }

  // Detect browser and device info
  const browserInfo = typeof window !== "undefined" ? detectBrowser() : null;

  const telemetryEvent: TelemetryEvent = {
    event,
    properties: {
      ...properties,
      environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV,
      userAgent: typeof window !== "undefined" ? window.navigator.userAgent : undefined,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      // Add parsed browser/device info
      browser: browserInfo?.browser,
      browserVersion: browserInfo?.browserVersion,
      os: browserInfo?.os,
      osVersion: browserInfo?.osVersion,
      deviceType: browserInfo?.deviceType,
      isMobile: browserInfo?.isMobile,
    },
    timestamp: Date.now(),
    // userId is no longer sent in payload; strict backend derives it from JWT
    sessionId: getSessionId(),
  };

  const performTracking = async () => {
    try {
      // Use fetchWithAuth to ensure proper authentication
      // Note: fetchWithAuth will throw if no session, so we catch and silently fail
      const response = await fetchWithAuth("/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(telemetryEvent),
        credentials: "include",
      });

      if (!response.ok) {
        const msg = `Telemetry POST /telemetry failed with status ${response.status}`;
        console.warn(msg);
        options?.onError?.({ event, message: msg, status: response.status });
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? `Telemetry POST /telemetry error: ${error.message}`
          : "Telemetry POST /telemetry encountered an unknown error";
      // Silently fail - don't break the app for telemetry
      console.debug("Telemetry error:", error);
      options?.onError?.({ event, message: msg });
    }
  };

  // Background the telemetry call to avoid blocking the main thread
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    requestIdleCallback(() => performTracking(), { timeout: 2000 });
  } else {
    setTimeout(performTracking, 0);
  }
}

// Runner-specific telemetry events
export async function trackRunnerResult(result: {
  exitCode: number;
  reason?: string | null;
  durationMs?: number;
  ttfr_ms?: number,
  pyodide_init_ms?: number;
  testsPassed?: number;
  testsTotal?: number;
  mode: "browser" | "server";
  problemId?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}) {
  await trackTelemetry("runner_result", {
    ttfr_ms: result.ttfr_ms,
    pyodide_init_ms: result.pyodide_init_ms,
    exit_code: result.exitCode,
    reason: result.reason,
    duration_ms: result.durationMs,
    tests_passed: result.testsPassed,
    tests_total: result.testsTotal,
    mode: result.mode,
    problem_id: result.problemId,
    fallback_used: result.fallbackUsed,
    fallback_reason: result.fallbackReason,
    success: result.exitCode === 0,
  });
}









