/**
 * profileManager - Client-side user profile management
 *
 * Handles:
 * - Downloading profile from server on session start
 * - Storing profile in IndexedDB for offline access
 * - Single-writer lock across tabs via BroadcastChannel API
 * - Periodic sync back to server
 *
 * Canonical representation of user actions: Sessions and Session Artifacts
 * (see .cursor/plans/shared_instrumentation_and_metrics_506970d1.plan.md).
 * ProfileInsights (narratives) are updated from session summaries via
 * profileNanoEditor.updateSessionNarratives(). ProfilePatterns are legacy
 * aggregates; server may compute them from session_artifacts.
 */

import { fetchWithAuth } from "./fetchWithAuth";

// ============================================================================
// Logging
// ============================================================================

const LOG_PREFIX = "[ProfileManager]";
const STYLES = {
  header:  "color: #E040FB; font-weight: bold",          // Pink/Purple
  success: "color: #4CAF50; font-weight: bold",           // Green
  warning: "color: #FF9800; font-weight: bold",           // Orange
  error:   "color: #F44336; font-weight: bold",           // Red
  info:    "color: #29B6F6; font-weight: bold",           // Light Blue
  detail:  "color: #9E9E9E; font-style: italic",          // Gray
  lock:    "color: #7C4DFF; font-weight: bold",           // Deep Purple
  sync:    "color: #00BCD4; font-weight: bold",           // Cyan
  data:    "color: #78909C",                               // Blue-grey
};

function profileLog(msg: string, style: string = STYLES.info, data?: unknown): void {
  if (data !== undefined) {
    console.log(`%c${LOG_PREFIX} ${msg}`, style, data);
  } else {
    console.log(`%c${LOG_PREFIX} ${msg}`, style);
  }
}

// ============================================================================
// Types
// ============================================================================

/** Optional narrative insight: unified session summary (multi-tier bullet list). */
export interface ProfileInsights {
  sessionSummaryNarrative?: string;
}

export interface UserProfile {
  _id: string;
  userId: string;
  version: number;
  patterns: ProfilePatterns;
  skills: ProfileSkills;
  weaknesses: WeaknessEntry[];
  insights?: ProfileInsights;
  dataPoints: number;
  timeAnalyzed: number;
  generatedAt: string;
  expiresAt: string;
}

export interface ProfilePatterns {
  avgTimePerProblem: number;
  avgTimePerProject: number;
  submitsBeforePass: number;
  errorsBeforePass: number;
  diffFrequency: number;
  avgSessionDuration: number;
  activeHours: number[];
  codeCopyFrequency: number;
  testRunFrequency: number;
  totalSessions: number;
  totalSubmissions: number;
  totalDiffs: number;
}

export interface ProfileSkills {
  topicScores: Record<string, number>;
  projectScores: Record<string, number>;
  overallLevel: string;
}

export interface WeaknessEntry {
  topic: string;
  score: number;
  evidence: string;
  confidence: number;
}

// ============================================================================
// IndexedDB Storage
// ============================================================================

const PROFILE_DB_NAME = "user-profile-cache";
const PROFILE_DB_VERSION = 1;
const PROFILE_STORE = "profile";

let profileDbInstance: IDBDatabase | null = null;

function openProfileDB(): Promise<IDBDatabase> {
  if (profileDbInstance) return Promise.resolve(profileDbInstance);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const request = indexedDB.open(PROFILE_DB_NAME, PROFILE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "section" });
      }
    };

    request.onsuccess = (event) => {
      profileDbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(profileDbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

async function storeProfileSection(section: string, data: unknown): Promise<void> {
  const db = await openProfileDB();
  const tx = db.transaction(PROFILE_STORE, "readwrite");
  const store = tx.objectStore(PROFILE_STORE);
  store.put({ section, data, updatedAt: Date.now() });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getProfileSection(section: string): Promise<unknown | null> {
  const db = await openProfileDB();
  const tx = db.transaction(PROFILE_STORE, "readonly");
  const store = tx.objectStore(PROFILE_STORE);

  return new Promise((resolve, reject) => {
    const request = store.get(section);
    request.onsuccess = () => resolve(request.result?.data ?? null);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// BroadcastChannel Lock (single-writer across tabs)
// ============================================================================

const CHANNEL_NAME = "profile-edit-lock";

let broadcastChannel: BroadcastChannel | null = null;
let isEditLockHolder = false;
let lockRequestId: string | null = null;

/**
 * Initialize the BroadcastChannel for cross-tab profile editing lock
 */
function initBroadcastChannel(): void {
  if (typeof BroadcastChannel === "undefined") return;
  if (broadcastChannel) return;

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

  broadcastChannel.onmessage = (event) => {
    const { type, requestId } = event.data;

    switch (type) {
      case "lock_request":
        if (isEditLockHolder) {
          profileLog("🔒 Denied lock request from another tab", STYLES.lock);
          broadcastChannel?.postMessage({
            type: "lock_denied",
            requestId,
          });
        }
        break;

      case "lock_denied":
        if (requestId === lockRequestId) {
          profileLog("🔒 Lock denied by another tab", STYLES.warning);
          isEditLockHolder = false;
        }
        break;

      case "lock_released":
        profileLog("🔓 Lock released by another tab", STYLES.lock);
        break;

      case "profile_updated":
        profileLog("📡 Another tab updated the profile, refreshing...", STYLES.sync);
        refreshLocalProfile();
        break;
    }
  };
}

/**
 * Attempt to acquire the edit lock
 * Returns true if we got the lock, false if another tab holds it
 */
export async function acquireEditLock(): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") {
    isEditLockHolder = true;
    profileLog("🔒 Lock acquired (no BroadcastChannel, single-tab mode)", STYLES.lock);
    return true;
  }

  initBroadcastChannel();

  lockRequestId = `lock_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  broadcastChannel?.postMessage({
    type: "lock_request",
    requestId: lockRequestId,
  });

  return new Promise((resolve) => {
    isEditLockHolder = true;
    setTimeout(() => {
      if (isEditLockHolder) {
        profileLog("🔒 Lock acquired", STYLES.lock);
      }
      resolve(isEditLockHolder);
    }, 200);
  });
}

/**
 * Release the edit lock
 */
export function releaseEditLock(): void {
  if (isEditLockHolder) {
    profileLog("🔓 Lock released", STYLES.lock);
  }
  isEditLockHolder = false;
  lockRequestId = null;
  broadcastChannel?.postMessage({ type: "lock_released" });
}

// ============================================================================
// Profile Download / Sync
// ============================================================================

let currentProfile: UserProfile | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let isDirty = false;
let visibilityHandler: (() => void) | null = null;

/**
 * Download the latest profile from the server and store locally
 */
export async function downloadProfile(): Promise<UserProfile | null> {
  profileLog("⬇️  Downloading profile from server...", STYLES.sync);
  try {
    const response = await fetchWithAuth("/profiles/me", {
      method: "GET",
    });

    if (!response.ok) {
      if (response.status === 404) {
        profileLog("📭 No profile on server yet (404)", STYLES.warning);
        return null;
      }
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const profile: UserProfile = await response.json();
    currentProfile = profile;

    // Store sections in IndexedDB
    const storePromises: Promise<void>[] = [
      storeProfileSection("patterns", profile.patterns),
      storeProfileSection("skills", profile.skills),
      storeProfileSection("weaknesses", profile.weaknesses),
      storeProfileSection("metadata", {
        _id: profile._id,
        userId: profile.userId,
        version: profile.version,
        dataPoints: profile.dataPoints,
        timeAnalyzed: profile.timeAnalyzed,
        generatedAt: profile.generatedAt,
        expiresAt: profile.expiresAt,
      }),
    ];
    if (profile.insights) {
      storePromises.push(storeProfileSection("insights", profile.insights));
    }
    await Promise.all(storePromises);

    profileLog(`✅ Downloaded profile v${profile.version}`, STYLES.success);
    console.groupCollapsed(`%c${LOG_PREFIX} 📊 Profile Summary`, STYLES.header);
    console.log(`%c  Version: ${profile.version}`, STYLES.data);
    console.log(`%c  Level: ${profile.skills.overallLevel}`, STYLES.data);
    console.log(`%c  Data Points: ${profile.dataPoints}`, STYLES.data);
    console.log(`%c  Time Analyzed: ${Math.round(profile.timeAnalyzed / 60000)}min`, STYLES.data);
    console.log(`%c  Weaknesses: ${profile.weaknesses.length}`, STYLES.data);
    if (profile.weaknesses.length > 0) {
      console.table(profile.weaknesses.map(w => ({
        topic: w.topic,
        score: w.score.toFixed(2),
        confidence: w.confidence.toFixed(2),
        evidence: w.evidence.slice(0, 60),
      })));
    }
    const projectEntries = Object.entries(profile.skills.projectScores);
    if (projectEntries.length > 0) {
      console.log(`%c  Project Scores:`, STYLES.data);
      console.table(Object.fromEntries(projectEntries.map(([k, v]) => [k, v.toFixed(2)])));
    }
    console.log(`%c  Patterns:`, STYLES.data, profile.patterns);
    console.groupEnd();

    return profile;
  } catch (err) {
    profileLog(`❌ Failed to download profile: ${err}`, STYLES.error);
    profileLog("📂 Falling back to local IndexedDB cache...", STYLES.warning);
    return loadLocalProfile();
  }
}

/**
 * Load the profile from IndexedDB (offline fallback)
 */
export async function loadLocalProfile(): Promise<UserProfile | null> {
  profileLog("📂 Loading profile from IndexedDB...", STYLES.info);
  try {
    const [patterns, skills, weaknesses, metadata, insights] = await Promise.all([
      getProfileSection("patterns"),
      getProfileSection("skills"),
      getProfileSection("weaknesses"),
      getProfileSection("metadata"),
      getProfileSection("insights"),
    ]);

    if (!metadata) {
      profileLog("📭 No local profile found in IndexedDB", STYLES.warning);
      return null;
    }

    const meta = metadata as Record<string, unknown>;
    currentProfile = {
      _id: meta._id as string,
      userId: meta.userId as string,
      version: meta.version as number,
      patterns: patterns as ProfilePatterns,
      skills: skills as ProfileSkills,
      weaknesses: weaknesses as WeaknessEntry[],
      insights: insights as ProfileInsights | undefined,
      dataPoints: meta.dataPoints as number,
      timeAnalyzed: meta.timeAnalyzed as number,
      generatedAt: meta.generatedAt as string,
      expiresAt: meta.expiresAt as string,
    };

    profileLog(
      `✅ Loaded local profile v${currentProfile.version} (${currentProfile.weaknesses.length} weaknesses, level: ${currentProfile.skills.overallLevel})`,
      STYLES.success
    );
    return currentProfile;
  } catch (err) {
    profileLog(`❌ Failed to load local profile: ${err}`, STYLES.error);
    return null;
  }
}

/**
 * Refresh local profile from IndexedDB (after another tab updated it)
 */
async function refreshLocalProfile(): Promise<void> {
  await loadLocalProfile();
}

/**
 * Get the current in-memory profile
 */
export function getCurrentProfile(): UserProfile | null {
  return currentProfile;
}

/**
 * Update the profile locally (requires edit lock)
 * The update will be synced to the server periodically
 */
export async function updateProfileLocally(
  updates: Partial<Pick<UserProfile, "weaknesses" | "skills" | "patterns" | "insights">>
): Promise<void> {
  if (!isEditLockHolder) {
    profileLog("⚠️  Cannot update profile without edit lock", STYLES.warning);
    return;
  }

  if (!currentProfile) {
    profileLog("⚠️  No profile loaded to update", STYLES.warning);
    return;
  }

  const updatedSections: string[] = [];

  // Apply updates
  if (updates.weaknesses) {
    currentProfile.weaknesses = updates.weaknesses;
    await storeProfileSection("weaknesses", updates.weaknesses);
    updatedSections.push(`weaknesses(${updates.weaknesses.length})`);
  }
  if (updates.skills) {
    currentProfile.skills = updates.skills;
    await storeProfileSection("skills", updates.skills);
    updatedSections.push(`skills(level=${updates.skills.overallLevel})`);
  }
  if (updates.patterns) {
    currentProfile.patterns = updates.patterns;
    await storeProfileSection("patterns", updates.patterns);
    updatedSections.push("patterns");
  }
  if (updates.insights) {
    currentProfile.insights = { ...currentProfile.insights, ...updates.insights };
    await storeProfileSection("insights", currentProfile.insights);
    updatedSections.push("insights");
  }

  isDirty = true;

  profileLog(`📝 Profile updated locally: ${updatedSections.join(", ")}`, STYLES.info);

  // Notify other tabs
  broadcastChannel?.postMessage({ type: "profile_updated" });
}

/**
 * Sync the current profile to the server
 */
export async function syncProfileToServer(): Promise<boolean> {
  if (!currentProfile || !isDirty) {
    profileLog("⏭️  Sync skipped (not dirty or no profile)", STYLES.detail);
    return false;
  }

  profileLog("⬆️  Syncing profile to server...", STYLES.sync);
  try {
    const response = await fetchWithAuth("/profiles/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weaknesses: currentProfile.weaknesses,
        skills: currentProfile.skills,
        patterns: currentProfile.patterns,
        ...(currentProfile.insights && { insights: currentProfile.insights }),
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const oldVersion = currentProfile.version;
      currentProfile.version = result.version;
      await storeProfileSection("metadata", {
        _id: currentProfile._id,
        userId: currentProfile.userId,
        version: result.version,
        dataPoints: currentProfile.dataPoints,
        timeAnalyzed: currentProfile.timeAnalyzed,
        generatedAt: currentProfile.generatedAt,
        expiresAt: currentProfile.expiresAt,
      });
      isDirty = false;
      profileLog(`✅ Synced to server (v${oldVersion} → v${result.version})`, STYLES.success);
      return true;
    }

    throw new Error(`Sync failed: ${response.status}`);
  } catch (err) {
    profileLog(`❌ Failed to sync profile to server: ${err}`, STYLES.error);
    return false;
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Initialize profile management on session start
 * - Downloads latest profile
 * - Starts periodic sync
 */
export async function initProfileManager(): Promise<void> {
  console.log(`%c${LOG_PREFIX} 🚀 Initializing Profile Manager`, STYLES.header);
  initBroadcastChannel();

  // Download latest profile
  await downloadProfile();

  // Start periodic sync (every 5 minutes)
  syncTimer = setInterval(async () => {
    if (isDirty) {
      profileLog("⏰ Periodic sync triggered", STYLES.sync);
      const gotLock = await acquireEditLock();
      if (gotLock) {
        try {
          await syncProfileToServer();
        } finally {
          releaseEditLock();
        }
      }
    }
  }, 5 * 60 * 1000);

  // Retry dirty sync when tab regains focus (covers offline -> online transitions)
  if (typeof document !== "undefined") {
    visibilityHandler = async () => {
      if (document.visibilityState === "visible" && isDirty) {
        profileLog("👁️  Tab visible + dirty profile, retrying sync...", STYLES.sync);
        const gotLock = await acquireEditLock();
        if (gotLock) {
          try {
            await syncProfileToServer();
          } finally {
            releaseEditLock();
          }
        }
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }

  profileLog("✅ Profile Manager initialized (sync interval: 5min, visibility retry: on)", STYLES.success);
}

/**
 * Cleanup profile manager
 */
export function cleanupProfileManager(): void {
  profileLog("🧹 Cleaning up Profile Manager...", STYLES.warning);

  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }

  // Final sync before cleanup if dirty (fire-and-forget)
  if (isDirty) {
    profileLog("📤 Final sync before cleanup (dirty profile)", STYLES.sync);
    syncProfileToServer();
  }

  releaseEditLock();

  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }

  profileLog("✅ Profile Manager cleaned up", STYLES.success);
}
