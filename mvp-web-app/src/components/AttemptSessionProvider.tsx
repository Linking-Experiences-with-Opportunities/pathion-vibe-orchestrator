"use client";

import React, { useState, useEffect } from "react";
import {
  startAttemptSession,
  setPresenceCheckHandler,
  cleanupAttemptSession,
  getSessionState,
} from "@/lib/attemptSession";
import { PresenceModal } from "@/components/PresenceModal";

type PresenceState = {
  open: boolean;
  onDismiss: () => void;
  onTimeout: () => void;
  timeoutMs: number;
} | null;

/**
 * Provides attempt session lifecycle and the "Still there?" presence modal.
 * Wrap project/problem pages or the layout that contains them so that
 * startAttemptSession/cleanupAttemptSession are called by the panels;
 * this provider only registers the presence handler and renders the modal.
 */
export function AttemptSessionProvider({ children }: { children: React.ReactNode }) {
  const [presence, setPresence] = useState<PresenceState>(null);

  useEffect(() => {
    setPresenceCheckHandler((options) => {
      setPresence({
        open: true,
        onDismiss: () => {
          options.onDismiss();
          setPresence(null);
        },
        onTimeout: () => {
          options.onTimeout();
          setPresence(null);
        },
        timeoutMs: options.timeoutMs,
      });
    });
    return () => {
      setPresenceCheckHandler(null);
    };
  }, []);

  return (
    <>
      {children}
      {presence && (
        <PresenceModal
          open={presence.open}
          onDismiss={presence.onDismiss}
          onTimeout={presence.onTimeout}
          timeoutMs={presence.timeoutMs}
        />
      )}
    </>
  );
}

// Re-export for panels
export {
  startAttemptSession,
  cleanupAttemptSession,
  getSessionState,
  recordRunOutcome,
  endAttemptSession,
} from "@/lib/attemptSession";
