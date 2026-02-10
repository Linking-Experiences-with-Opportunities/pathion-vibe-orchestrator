"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getDecisionTraceSession,
  getDecisionTraceTimeline,
  getDecisionTraceEvent,
  type DecisionTraceTimelineEntryResponse,
  type DecisionTraceEventResponse,
} from "@/lib/decisionTraceClient";

/** Timeline event shape used by RetrospectiveView (matches existing UI). */
export interface TimelineEvent {
  id: string;
  time: string;
  type: "start" | "fail" | "progress" | "regression" | "struggle" | "success";
  label: string;
  meta: string;
  code: string;
  headline?: string;
  details?: string;
  proTip?: string;
}

/** Derive display type from backend event. */
function deriveEventType(
  entry: DecisionTraceTimelineEntryResponse,
  index: number
): TimelineEvent["type"] {
  const isFirst = index === 0;
  const failed = (entry.testsFailed ?? 0) > 0;
  if (isFirst) return "start";
  if (entry.eventType === "SUBMIT" && !failed) return "success";
  if (failed) return "fail";
  return "progress";
}

/** Format createdAt to "MM:SS" for display. */
function formatTime(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    const m = d.getMinutes();
    const s = d.getSeconds();
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  } catch {
    return "00:00";
  }
}

/** Build list-item event from timeline entry (code/headline/details/proTip loaded on demand). */
function timelineEntryToEvent(
  entry: DecisionTraceTimelineEntryResponse,
  index: number
): TimelineEvent {
  const type = deriveEventType(entry, index);
  const failed = (entry.testsFailed ?? 0) > 0;
  const label =
    entry.eventType === "SUBMIT"
      ? failed
        ? `Submit — ${entry.testsFailed} failed`
        : "Submit — All passed"
      : failed
        ? "Run — tests failed"
        : "Run";
  const meta = entry.universalErrorCode ?? entry.eventType;
  return {
    id: entry.eventId,
    time: formatTime(entry.createdAt),
    type,
    label,
    meta,
    code: "",
    headline: undefined,
    details: undefined,
    proTip: undefined,
  };
}

/** Build full TimelineEvent from GET /decision-trace/event response. */
function eventResponseToTimelineEvent(
  eventId: string,
  res: DecisionTraceEventResponse
): TimelineEvent {
  const e = res.event;
  const entry: DecisionTraceTimelineEntryResponse = {
    eventId: e._id,
    createdAt: e.createdAt,
    eventType: e.eventType as "RUN" | "SUBMIT",
    testsFailed: e.execution?.tests?.failed ?? undefined,
    universalErrorCode: e.execution?.universalErrorCode ?? undefined,
  };
  const base = timelineEntryToEvent(entry, -1);
  base.code = e.code?.text ?? "";
  base.headline =
    e.ai?.gemini?.responseText?.split("\n")[0]?.slice(0, 80) ??
    (e.eventType === "SUBMIT" ? "Submit" : "Run");
  base.details =
    e.execution?.errorLog ??
    (e.execution?.tests
      ? `${e.execution.tests.passed ?? 0}/${e.execution.tests.total ?? 0} passed`
      : undefined) ??
    "";
  base.proTip = e.ai?.gemini?.responseText ?? undefined;
  return base;
}

export interface UseDecisionTraceRetrospectiveResult {
  events: TimelineEvent[];
  loading: boolean;
  error: string | null;
  loadEvent: (eventId: string) => Promise<TimelineEvent | null>;
}

/**
 * Fetches decision-trace session + timeline for a content item.
 * Use when RetrospectiveView is opened with contentId + contentType (e.g. project).
 * Auth: required (JWT).
 */
export function useDecisionTraceRetrospective(
  contentId: string | undefined,
  contentType: "project" | "problem" | "module_problem" | undefined
): UseDecisionTraceRetrospectiveResult {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentId || !contentType) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const sessionRes = await getDecisionTraceSession(contentId, contentType);
        if (cancelled) return;
        if (!sessionRes.session) {
          setEvents([]);
          setLoading(false);
          return;
        }
        const timelineRes = await getDecisionTraceTimeline(sessionRes.session._id);
        if (cancelled) return;
        const mapped = timelineRes.events.map((entry, index) =>
          timelineEntryToEvent(entry, index)
        );
        setEvents(mapped);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load timeline");
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contentId, contentType]);

  const loadEvent = useCallback(async (eventId: string): Promise<TimelineEvent | null> => {
    try {
      const res = await getDecisionTraceEvent(eventId);
      return eventResponseToTimelineEvent(eventId, res);
    } catch {
      return null;
    }
  }, []);

  return { events, loading, error, loadEvent };
}
