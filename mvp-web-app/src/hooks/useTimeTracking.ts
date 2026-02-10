"use client";

import { useEffect, useRef, useCallback } from "react";
// import { useProgress } from '@/contexts/ProgressContext';

export function useTimeTracking(lessonId: string, lessonName: string, pageNumber: number) {
  // const { updateProgress } = useProgress();

  const startTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasMarkedCompletedRef = useRef<boolean>(false);

  const markPageCompleted = useCallback(() => {
    if (hasMarkedCompletedRef.current) return; // Prevent double-marking

    console.log(`[TIME_TRACKING] Marking page ${pageNumber} of lesson ${lessonId} as completed`);
    hasMarkedCompletedRef.current = true;

    // Call your backend or context update here
    // updateProgress(lessonId, lessonName, pageNumber, true);
  }, [lessonId, pageNumber]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY + window.innerHeight;
      const scrollHeight = document.documentElement.scrollHeight;
      const scrollPercentage = (scrollTop / scrollHeight) * 100;

      if (scrollPercentage >= 85) {
        console.log(`[TIME_TRACKING] User scrolled to ${scrollPercentage.toFixed(1)}% of page - marking as completed`);
        markPageCompleted();
        window.removeEventListener("scroll", handleScroll);
      }
    };

    const autoCompleteTimer = setTimeout(() => {
      console.log(`[TIME_TRACKING] Auto-completing page after 3 minutes`);
      markPageCompleted();
    }, 180000); // 3 minutes

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      clearTimeout(autoCompleteTimer);
    };
  }, [markPageCompleted]);

  useEffect(() => {
    console.log(`[TIME_TRACKING] Starting time tracking for Lesson ${lessonId} Page ${pageNumber}`);
    startTimeRef.current = Date.now();
    hasMarkedCompletedRef.current = false;
    const intervalId = intervalRef.current;

    return () => {
      console.log(`[TIME_TRACKING] Cleaning up time tracking for Lesson ${lessonId} Page ${pageNumber}`);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [lessonId, pageNumber]);

  return { markPageCompleted };
}
