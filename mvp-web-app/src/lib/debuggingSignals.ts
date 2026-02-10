/**
 * Debugging signals for Metric 5 (Debugging Intelligence).
 * Records: console/result panel focus, re-run same failing test, optional edit ranges.
 * Session module consumes these to compute diagnosis_latency, edit_to_run_ratio, localization_score, hypothesis_test_cycles.
 */

export type DebuggingSignalType =
  | "console_focus"
  | "rerun_same_test"
  | "edit_range";

export interface DebuggingSignal {
  type: DebuggingSignalType;
  atMs: number;
  testCaseNumber?: number;
  /** Editor selection or edit range (line start, line end) for localization */
  lineStart?: number;
  lineEnd?: number;
}

const MAX_SIGNALS = 50;
let signals: DebuggingSignal[] = [];

export function recordConsoleFocus(): void {
  signals.push({ type: "console_focus", atMs: Date.now() });
  if (signals.length > MAX_SIGNALS) signals = signals.slice(-MAX_SIGNALS);
}

export function recordRerunSameTest(testCaseNumber: number): void {
  signals.push({ type: "rerun_same_test", atMs: Date.now(), testCaseNumber });
  if (signals.length > MAX_SIGNALS) signals = signals.slice(-MAX_SIGNALS);
}

export function recordEditRange(lineStart: number, lineEnd: number): void {
  signals.push({
    type: "edit_range",
    atMs: Date.now(),
    lineStart,
    lineEnd,
  });
  if (signals.length > MAX_SIGNALS) signals = signals.slice(-MAX_SIGNALS);
}

export function getDebuggingSignalsSnapshot(): DebuggingSignal[] {
  return [...signals];
}

export function clearDebuggingSignals(): void {
  signals = [];
}
