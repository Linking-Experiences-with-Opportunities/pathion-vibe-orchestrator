/**
 * User Tests Backend Sync - Optional backend synchronization for user tests
 *
 * Provides functions to sync user tests with the backend API.
 * Falls back to localStorage-only mode if backend is unavailable.
 */

import { UserTest } from "./userTests";
import { fetchWithAuth } from "./fetchWithAuth";

/**
 * Load user tests from backend for a project
 * Falls back to null if backend is unavailable (caller should use localStorage)
 */
export async function loadUserTestsFromBackend(
  projectId: string
): Promise<UserTest[] | null> {
  try {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects/${projectId}/user-tests`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      console.warn(`Failed to load user tests from backend: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.tests)) {
      return data.tests;
    }

    return null;
  } catch (error) {
    console.error("Error loading user tests from backend:", error);
    return null;
  }
}

/**
 * Save user tests to backend for a project
 * Returns true if successful, false if failed (caller should rely on localStorage)
 */
export async function saveUserTestsToBackend(
  projectId: string,
  tests: UserTest[]
): Promise<boolean> {
  try {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects/${projectId}/user-tests`;
    const response = await fetchWithAuth(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tests }),
    });

    if (!response.ok) {
      console.warn(`Failed to save user tests to backend: ${response.status}`);
      return false;
    }

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error("Error saving user tests to backend:", error);
    return false;
  }
}

/**
 * Delete user tests from backend for a project
 * Returns true if successful, false if failed
 */
export async function deleteUserTestsFromBackend(
  projectId: string
): Promise<boolean> {
  try {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects/${projectId}/user-tests`;
    const response = await fetchWithAuth(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      console.warn(`Failed to delete user tests from backend: ${response.status}`);
      return false;
    }

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error("Error deleting user tests from backend:", error);
    return false;
  }
}

/**
 * Load all user tests across all projects from backend
 * Returns null if backend is unavailable
 */
export async function loadAllUserTestsFromBackend(): Promise<
  Array<{ projectId: string; tests: UserTest[] }> | null
> {
  try {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/user-tests`;
    const response = await fetchWithAuth(url);

    if (!response.ok) {
      console.warn(`Failed to load all user tests from backend: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.tests)) {
      return data.tests.map((doc: any) => ({
        projectId: doc.projectId,
        tests: doc.tests,
      }));
    }

    return null;
  } catch (error) {
    console.error("Error loading all user tests from backend:", error);
    return null;
  }
}

/**
 * Sync strategy: Load from backend first, fallback to localStorage
 *
 * This function demonstrates how to use both backend and localStorage together:
 * 1. Try to load from backend
 * 2. If backend fails or returns nothing, use localStorage
 * 3. If backend succeeds, merge/replace with localStorage data
 */
export async function loadUserTestsWithSync(
  projectId: string,
  localStorageTests: UserTest[]
): Promise<UserTest[]> {
  // Try backend first
  const backendTests = await loadUserTestsFromBackend(projectId);

  // If backend is available and has data, use it
  if (backendTests !== null && backendTests.length > 0) {
    return backendTests;
  }

  // Fall back to localStorage
  return localStorageTests;
}

/**
 * Sync strategy: Save to both backend and localStorage
 *
 * This function demonstrates how to save to both locations:
 * 1. Save to localStorage (always succeeds, local backup)
 * 2. Try to save to backend (may fail if offline/unauthorized)
 */
export async function saveUserTestsWithSync(
  projectId: string,
  tests: UserTest[],
  saveToLocalStorage: (projectId: string, tests: UserTest[]) => void
): Promise<void> {
  // Always save to localStorage first (local backup)
  saveToLocalStorage(projectId, tests);

  // Then try to sync to backend
  const success = await saveUserTestsToBackend(projectId, tests);

}
