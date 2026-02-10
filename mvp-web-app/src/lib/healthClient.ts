import { getApiUrl } from "@/lib/apiConfig";

export type HealthResponse = {
  status: "ok" | string;
  service: "questions-api" | string;
  env: "local" | "staging" | "prod" | string;
  version: string;
  build_time: string;
  server_time: string;
};

export type HealthClientError = {
  status: number; // 0 = network error (no HTTP response)
  message: string;
  payload?: unknown;
};

export async function getHealth(opts?: { cacheBust?: boolean }): Promise<HealthResponse> {
  const path = opts?.cacheBust ? `/api/health?ts=${Date.now()}` : "/api/health";
  const url = getApiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const e: HealthClientError = {
      status: 0,
      message: "Network error reaching backend",
      payload: err,
    };
    throw e;
  }

  let payload: unknown = undefined;
  try {
    payload = await res.json();
  } catch {
    // ignore non-JSON body
  }

  if (!res.ok) {
    const e: HealthClientError = {
      status: res.status,
      message: `Health request failed (${res.status})`,
      payload,
    };
    throw e;
  }

  return payload as HealthResponse;
}
