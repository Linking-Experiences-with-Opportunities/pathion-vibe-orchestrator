"use client";

import React, { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface PresenceModalProps {
  open: boolean;
  onDismiss: () => void;
  onTimeout: () => void;
  timeoutMs: number;
}

/**
 * "Still there?" presence check modal. Shown when the user has been idle (no diff changes)
 * for a number of 15s ticks. Dismissing (clicking "Still here") calls onDismiss; if the user
 * does nothing for timeoutMs, onTimeout is called and the session can be ended.
 */
export function PresenceModal({
  open,
  onDismiss,
  onTimeout,
  timeoutMs,
}: PresenceModalProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onTimeout();
    }, timeoutMs);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [open, timeoutMs, onTimeout]);

  const handleDismiss = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleDismiss(); }}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={handleDismiss}
        onEscapeKeyDown={handleDismiss}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Still there?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          You&apos;ve been idle for a while. Click below to keep your session active, or we&apos;ll end it in a few seconds.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={handleDismiss} type="button">
            Still here
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
