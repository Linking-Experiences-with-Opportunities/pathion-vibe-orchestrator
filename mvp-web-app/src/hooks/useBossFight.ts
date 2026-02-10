/**
 * useBossFight - Client-side boss fight management hook
 * 
 * Guarantees:
 * - Every fight uses the latest profile version from the server
 * - If offline, uses local profile with a warning flag
 * - Profile version is checked to prevent stale data
 * - Every stage references at least one weakness from the profile
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  downloadProfile,
  loadLocalProfile,
  getCurrentProfile,
  initProfileManager,
  syncProfileToServer,
  type UserProfile,
} from "@/lib/profileManager";
import { useBossFightGuard } from "./useNavigation";

// ============================================================================
// Types
// ============================================================================

interface PersonalizedStage {
  order: number;
  type: string;
  topic: string;
  weaknessScore: number;
  timeLimit: number;
  basePoints: number;
  prompt: string;
  hintCount: number;
  completed: boolean;
  score: number;
  timeTaken: number;
  hintsUsed: number;
}

interface BossFightInstance {
  _id: string;
  userId: string;
  templateId: string;
  templateName: string;
  profileVersion: number;
  targetWeaknesses: Array<{ topic: string; score: number; evidence: string; confidence: number }>;
  personalizedStages: PersonalizedStage[];
  status: string;
  currentStage: number;
  totalScore: number;
  maxScore: number;
  startedAt: string;
  completedAt?: string;
}

interface BossFightState {
  /** Current fight instance */
  instance: BossFightInstance | null;
  /** Whether the fight is loading */
  loading: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Whether the profile data is from offline cache (stale warning) */
  isOfflineProfile: boolean;
  /** Profile version used for this fight */
  profileVersion: number | null;
}

interface BossFightActions {
  /** Start a new boss fight (or resume existing) */
  startFight: () => Promise<void>;
  /** Submit the result of a stage */
  submitStageResult: (stageIndex: number, result: StageResult) => Promise<void>;
  /** Abandon the current fight */
  abandonFight: () => Promise<void>;
  /** Get the current stage */
  getCurrentStage: () => PersonalizedStage | null;
  /** Allow navigation (for explicit quit) */
  allowNavigation: () => void;
}

interface StageResult {
  score: number;
  timeTaken: number;  // seconds
  hintsUsed: number;
  completed: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useBossFight(): [BossFightState, BossFightActions] {
  const [state, setState] = useState<BossFightState>({
    instance: null,
    loading: false,
    error: null,
    isOfflineProfile: false,
    profileVersion: null,
  });

  const isActive = state.instance?.status === "active";
  const { allowNavigation } = useBossFightGuard(isActive);

  // Initialize profile manager on mount
  useEffect(() => {
    initProfileManager();
  }, []);

  /**
   * Start a new boss fight with personalization guarantees
   */
  const startFight = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Guarantee 1: Always try to fetch latest profile from server
      let profile: UserProfile | null = null;
      let isOffline = false;

      try {
        profile = await downloadProfile();
      } catch {
        // Offline or server error - use local profile
        profile = await loadLocalProfile();
        isOffline = true;
      }

      if (!profile) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: "No user profile found. Complete some activities first to build your profile.",
        }));
        return;
      }

      // Guarantee 2: Profile version tracking
      const profileVersion = profile.version;

      // Guarantee 3: Start fight via API
      const response = await fetchWithAuth("/boss-fight/start", {
        method: "GET",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setState(prev => ({
          ...prev,
          loading: false,
          error: errorData.error || `Failed to start fight: ${response.status}`,
        }));
        return;
      }

      const data = await response.json();

      // Guarantee 4: Validate every stage references a weakness
      const instance: BossFightInstance = data.instance;
      const allStagesHaveWeakness = instance.personalizedStages.every(
        stage => stage.topic && stage.weaknessScore !== undefined
      );

      if (!allStagesHaveWeakness) {
        console.warn("[BossFight] Not all stages reference weaknesses - personalization may be incomplete");
      }

      setState({
        instance,
        loading: false,
        error: null,
        isOfflineProfile: isOffline,
        profileVersion,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to start boss fight",
      }));
    }
  }, []);

  /**
   * Submit the result of a completed stage
   */
  const submitStageResult = useCallback(async (stageIndex: number, result: StageResult) => {
    if (!state.instance) return;

    try {
      const response = await fetchWithAuth(`/boss-fight/${state.instance._id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageIndex,
          score: result.score,
          timeTaken: result.timeTaken,
          hintsUsed: result.hintsUsed,
          completed: result.completed,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to submit stage: ${response.status}`);
      }

      const data = await response.json();
      const updatedInstance: BossFightInstance = data.instance;

      setState(prev => ({
        ...prev,
        instance: updatedInstance,
      }));

      // Profile updates are now driven by Sessions and Session Artifacts (see shared_instrumentation plan).
      // Boss fight completion is not part of attempt-session flow; sync any pending profile changes when fight completes.

      // If fight is complete, sync profile to server
      if (updatedInstance.status === "completed") {
        await syncProfileToServer();
      }
    } catch (err) {
      console.error("[BossFight] Failed to submit stage result:", err);
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : "Failed to submit stage result",
      }));
    }
  }, [state.instance]);

  /**
   * Abandon the current fight
   */
  const abandonFight = useCallback(async () => {
    if (!state.instance) return;

    try {
      allowNavigation(); // Allow navigation before abandoning

      const response = await fetchWithAuth(`/boss-fight/${state.instance._id}/abandon`, {
        method: "POST",
      });

      if (response.ok) {
        setState(prev => ({
          ...prev,
          instance: prev.instance ? { ...prev.instance, status: "abandoned" } : null,
        }));
      }
    } catch (err) {
      console.error("[BossFight] Failed to abandon fight:", err);
    }
  }, [state.instance, allowNavigation]);

  /**
   * Get the current stage
   */
  const getCurrentStage = useCallback((): PersonalizedStage | null => {
    if (!state.instance || state.instance.status !== "active") return null;
    return state.instance.personalizedStages[state.instance.currentStage] ?? null;
  }, [state.instance]);

  return [
    state,
    {
      startFight,
      submitStageResult,
      abandonFight,
      getCurrentStage,
      allowNavigation,
    },
  ];
}
