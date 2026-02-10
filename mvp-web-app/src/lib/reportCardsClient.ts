import { fetchWithAuth } from "./fetchWithAuth";

export type ReportCardJob = "create" | "revise" | "interpret" | "manage";
export type ReportCardManageAction = "list" | "get" | "archive";

export interface ReportCardJobRequest {
  job: ReportCardJob;
  model?: string;
  sessionWindow?: number;
  reportId?: string;
  manualParagraph?: string;
  promptContext?: string;
  revisionReason?: string;
  action?: ReportCardManageAction;
  includeArchived?: boolean;
}

export async function getMyReportCards(): Promise<any> {
  const response = await fetchWithAuth("/report-cards/me", { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch report cards: ${response.status} ${text}`);
  }
  return response.json();
}

export async function runReportCardJob(payload: ReportCardJobRequest): Promise<any> {
  const response = await fetchWithAuth("/report-cards/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Report card job failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function createReportCardFromLLM(options?: {
  model?: string;
  sessionWindow?: number;
  promptContext?: string;
}): Promise<any> {
  return runReportCardJob({
    job: "create",
    model: options?.model,
    sessionWindow: options?.sessionWindow,
    promptContext: options?.promptContext,
  });
}

export async function createReportCardFromParagraph(paragraph: string, sessionWindow = 12): Promise<any> {
  return runReportCardJob({
    job: "create",
    manualParagraph: paragraph,
    sessionWindow,
  });
}

export async function reviseReportCard(reportId: string, paragraph: string, reason = ""): Promise<any> {
  return runReportCardJob({
    job: "revise",
    reportId,
    manualParagraph: paragraph,
    revisionReason: reason,
  });
}

export async function interpretReportCard(reportId?: string): Promise<any> {
  return runReportCardJob({
    job: "interpret",
    reportId,
  });
}

export async function listReportCards(includeArchived = false): Promise<any> {
  return runReportCardJob({
    job: "manage",
    action: "list",
    includeArchived,
  });
}

export async function archiveReportCard(reportId: string): Promise<any> {
  return runReportCardJob({
    job: "manage",
    action: "archive",
    reportId,
  });
}
