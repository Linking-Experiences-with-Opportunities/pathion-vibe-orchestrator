// Feature flags for runner execution
// FORCE_LOCAL: prefer browser execution (default: false)
// FORCE_SERVER: force server execution (default: false)
// FORCE_SERVER overrides FORCE_LOCAL

const FORCE_LOCAL = process.env.NEXT_PUBLIC_FORCE_LOCAL === 'true' || false;
const FORCE_SERVER = process.env.NEXT_PUBLIC_FORCE_SERVER === 'true' || false;

export const flags = {
  FORCE_LOCAL,
  FORCE_SERVER,
  // Computed: should we prefer browser execution?
  preferBrowser: !FORCE_SERVER && (FORCE_LOCAL || true), // Default to browser
  // Computed: should we force server execution?
  forceServer: FORCE_SERVER,
};

export const FEATURE_MERMAID_DEBUGGER = process.env.NEXT_PUBLIC_FEATURE_MERMAID_DEBUGGER === 'true';
export const FEATURE_TRACE_TIMELINE = process.env.NEXT_PUBLIC_FEATURE_TRACE_TIMELINE === 'true';
export const FEATURE_CHALLENGE_MODE = process.env.NEXT_PUBLIC_FEATURE_CHALLENGE_MODE === 'true';

export const FEATURE_STEP_DEBUGGER = process.env.NEXT_PUBLIC_FEATURE_STEP_DEBUGGER === 'true';
export const FEATURE_MILESTONE_VISUALIZER = process.env.NEXT_PUBLIC_FEATURE_MILESTONE_VISUALIZER === 'true';

// Legacy compatibility
export const USE_LEGACY_RUNNER = false;
export const forceBrowser = flags.preferBrowser;
export const forceServer = flags.forceServer;