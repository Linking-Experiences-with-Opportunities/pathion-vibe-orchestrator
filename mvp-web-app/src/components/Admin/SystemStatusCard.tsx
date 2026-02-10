"use client";

import React, { useEffect, useState } from "react";
import { getHealth, type HealthResponse, type HealthClientError } from "@/lib/healthClient";

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

export default function SystemStatusCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let intervalId: any = null;

    const refresh = async () => {
      // Only poll when the tab is visible (reduces load)
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      try {
        const health = await getHealth({ cacheBust: true });
        if (cancelled) return;

        setState({ kind: "ok", data: health });

        // Dev-only logging 
        if (process.env.NODE_ENV === "development") {
          console.log(
            `Backend health: env=${health.env} version=${health.version} time=${health.server_time}`
          );
        }
      } catch (err) {
        if (cancelled) return;

        setState({ kind: "error", message: "Backend unreachable" });

        const e = err as Partial<HealthClientError>;

        // Dev-only failure logging 
        if (process.env.NODE_ENV === "development") {
          console.log("Backend health failed:", {
            status: e?.status,
            message: e?.message,
            payload: e?.payload,
          });
        }
      }
    };

    // Fetch on dashboard load 
    refresh();

    // Poll every 30s while visible ( low load)
    intervalId = setInterval(refresh, 30000);

    // Refresh immediately when tab becomes visible again
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">System Status</p>

        {state.kind === "loading" && <span className="text-xs text-slate-400">Checking…</span>}
        {state.kind === "ok" && <span className="text-xs text-emerald-300">Connected</span>}
        {state.kind === "error" && <span className="text-xs text-rose-300">Unreachable</span>}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        {state.kind === "ok" ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Environment</span>
              <span className="font-mono text-white">{state.data.env}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Version</span>
              <span className="font-mono text-white truncate max-w-[240px]">
                {state.data.version}
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Server time</span>
              <span className="font-mono text-white">{state.data.server_time}</span>
            </div>
          </>
        ) : state.kind === "error" ? (
          <div className="mt-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-rose-200 text-sm">
            Backend unreachable
          </div>
        ) : (
          <div className="mt-2 text-slate-400 text-sm">Loading backend status…</div>
        )}
      </div>
    </div>
  );
}
