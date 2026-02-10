import { VizPayloadV1 } from "./vizPayload";

const VIZ_START_MARKER = "=== VIZ_PAYLOAD_START ===";
const VIZ_END_MARKER = "=== VIZ_PAYLOAD_END ===";

/**
 * Parses the visualization payload from the runner's stdout.
 * The payload is expected to be a JSON string wrapped in markers.
 * 
 * Format:
 * === VIZ_PAYLOAD_START ===
 * { ... json ... }
 * === VIZ_PAYLOAD_END ===
 * 
 * @param stdout - The full stdout string from the runner
 * @returns The parsed VizPayloadV1['viz'] object or null if not found/invalid
 */
export function parseVizPayloadFromStdout(stdout: string): VizPayloadV1['viz'] | null {
  if (!stdout) return null;

  const startIndex = stdout.indexOf(VIZ_START_MARKER);
  const endIndex = stdout.indexOf(VIZ_END_MARKER);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return null;
  }

  try {
    // Extract JSON content between markers
    const jsonString = stdout.substring(startIndex + VIZ_START_MARKER.length, endIndex).trim();
    const payload = JSON.parse(jsonString);

    // Basic validation of shape — markers is optional for some structure types
    if (payload && payload.diagramType && payload.structure) {
      return {
        ...payload,
        markers: payload.markers || {},
      } as VizPayloadV1['viz'];
    }

    console.warn("[VizParser] Invalid payload shape found in stdout");
    return null;
  } catch (e) {
    console.error("[VizParser] Failed to parse viz payload JSON:", e);
    return null;
  }
}
