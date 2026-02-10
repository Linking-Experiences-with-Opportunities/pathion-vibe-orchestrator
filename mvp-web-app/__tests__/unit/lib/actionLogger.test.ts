/**
 * Tests for actionLogger debounce behavior
 * 
 * Tests verify:
 * - Rapid identical events collapse into one
 * - Different targets within debounce window are kept
 * - Events outside debounce window are kept
 * - Zero-debounce events always pass through
 */

// Mock dependencies before importing
jest.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: jest.fn(),
}));

jest.mock("@/lib/apiConfig", () => ({
  isApiConfigured: jest.fn(() => false),
}));

jest.mock("@/lib/utils/browserDetection", () => ({
  detectBrowser: jest.fn(() => ({
    browser: "Chrome",
    os: "macOS",
    deviceType: "desktop",
  })),
}));

// Mock sessionStorage
const mockSessionStorage: Record<string, string> = {};
Object.defineProperty(window, "sessionStorage", {
  value: {
    getItem: (key: string) => mockSessionStorage[key] ?? null,
    setItem: (key: string, value: string) => { mockSessionStorage[key] = value; },
    removeItem: (key: string) => { delete mockSessionStorage[key]; },
    clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); },
  },
  writable: true,
});

// Override NODE_ENV for tests
const originalEnv = process.env.NODE_ENV;

describe("actionLogger debounce", () => {
  let logAction: typeof import("@/lib/actionLogger").logAction;
  let getBufferSize: typeof import("@/lib/actionLogger").getBufferSize;

  beforeEach(() => {
    jest.resetModules();
    // We need to set NODE_ENV to something other than "test" since logAction
    // returns early in test mode. We'll use "development" and import fresh.
    process.env.NODE_ENV = "development";

    // Fresh import for each test
    const mod = require("@/lib/actionLogger");
    logAction = mod.logAction;
    getBufferSize = mod.getBufferSize;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
  });

  it("collapses rapid identical events (same type + same target) into one", () => {
    const now = Date.now();

    // Fire 5 rapid tab_focus events (1000ms debounce threshold)
    logAction({ type: "tab_focus", timestamp: now });
    logAction({ type: "tab_focus", timestamp: now + 50 });
    logAction({ type: "tab_focus", timestamp: now + 100 });
    logAction({ type: "tab_focus", timestamp: now + 200 });
    logAction({ type: "tab_focus", timestamp: now + 300 });

    // Should only have 1 event (+ possible session_start from getSessionId)
    // Filter to just tab_focus events
    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const tabFocusEvents = buffer.filter((e: any) => e.type === "tab_focus");
    expect(tabFocusEvents.length).toBe(1);
  });

  it("keeps events with different targets within debounce window", () => {
    const now = Date.now();

    // Fire rapid button clicks with different targets (300ms debounce)
    logAction({ type: "button_click", target: "btn-a", timestamp: now });
    logAction({ type: "button_click", target: "btn-b", timestamp: now + 50 });
    logAction({ type: "button_click", target: "btn-c", timestamp: now + 100 });

    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const clickEvents = buffer.filter((e: any) => e.type === "button_click");
    expect(clickEvents.length).toBe(3);
  });

  it("keeps events outside the debounce window", () => {
    const now = Date.now();

    // Fire tab_blur events outside the 1000ms debounce window
    logAction({ type: "tab_blur", timestamp: now });
    logAction({ type: "tab_blur", timestamp: now + 1100 }); // Outside 1000ms window

    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const blurEvents = buffer.filter((e: any) => e.type === "tab_blur");
    expect(blurEvents.length).toBe(2);
  });

  it("never debounces zero-threshold events (run_code_click, submit_click)", () => {
    const now = Date.now();

    // Fire rapid run_code_click events (0ms debounce = always pass through)
    logAction({ type: "run_code_click", target: "proj-1", timestamp: now });
    logAction({ type: "run_code_click", target: "proj-1", timestamp: now + 10 });
    logAction({ type: "run_code_click", target: "proj-1", timestamp: now + 20 });

    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const runEvents = buffer.filter((e: any) => e.type === "run_code_click");
    expect(runEvents.length).toBe(3);
  });

  it("never debounces submit_click events", () => {
    const now = Date.now();

    logAction({ type: "submit_click", target: "proj-1", timestamp: now });
    logAction({ type: "submit_click", target: "proj-1", timestamp: now + 5 });

    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const submitEvents = buffer.filter((e: any) => e.type === "submit_click");
    expect(submitEvents.length).toBe(2);
  });

  it("updates timestamp of last matching event when debouncing", () => {
    const now = Date.now();

    logAction({ type: "tab_focus", timestamp: now });
    logAction({ type: "tab_focus", timestamp: now + 200 }); // Debounced

    const buffer = (window as any).actionLogger?.getBuffer?.() ?? [];
    const tabFocusEvents = buffer.filter((e: any) => e.type === "tab_focus");
    expect(tabFocusEvents.length).toBe(1);
    // The timestamp should have been updated to the later one
    expect(tabFocusEvents[0].timestamp).toBe(now + 200);
  });
});
