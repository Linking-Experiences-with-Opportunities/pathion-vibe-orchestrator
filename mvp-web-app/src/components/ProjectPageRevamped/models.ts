// Project submission models based on questions-api/database/browser_submissions.go

export interface BrowserTestCaseResult {
  id?: string;
  fn: string;
  passed: boolean;
  received?: any;
  expected?: any;
  durationMs: number;
  error?: string;
}

export interface BrowserTestSummary {
  total: number;
  passed: number;
  failed: number;
  cases: BrowserTestCaseResult[];
}

export interface BrowserExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  testSummary?: BrowserTestSummary;
  durationMs?: number;
}

import { VizPayloadV1 } from "@/lib/vizPayload";

export interface BrowserExecutionMeta {
  pyodideVersion: string;
  timedOut?: boolean;
  memExceeded?: boolean;
  sandboxBootMs?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  vizPayload?: VizPayloadV1;
}

export interface ProjectSubmission {
  _id: string;
  problemId: string;
  userId: string;
  email?: string;
  language: string;
  sourceType: string;
  files?: Record<string, string>;
  userTestsCode?: string; // User-written test code
  userTestsResults?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'error';
    error: string | null;
  }>;
  result: BrowserExecutionResult;
  meta: BrowserExecutionMeta;
  passed: boolean;
  createdAt: string;
}

