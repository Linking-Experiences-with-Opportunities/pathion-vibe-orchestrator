"use client";

import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { Loader2 } from "lucide-react";

mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "monospace",
});

interface MermaidProps {
    chart: string;
    /** Optional callback fired when a user clicks a node with a `click ... call mermaidNodeClick` directive. */
    onNodeClick?: (nodeId: string) => void;
}

export const Mermaid: React.FC<MermaidProps> = ({ chart, onNodeClick }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string | null>(null);

    // Register the global mermaidNodeClick callback so Mermaid's
    // onclick handlers (generated when securityLevel is "loose") can reach us.
    useEffect(() => {
        (window as any).mermaidNodeClick = (nodeId: string) => {
            console.log(`[Gate 2] Evidence Acknowledged: ${nodeId}`);
            onNodeClick?.(nodeId);
        };

        return () => {
            delete (window as any).mermaidNodeClick;
        };
    }, [onNodeClick]);

    const RENDER_TIMEOUT_MS = 15000;

    useEffect(() => {
        const renderChart = async () => {
            if (!chart) return;
            console.log("[Mermaid] render start, chart length:", chart.length);

            const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

            try {
                const result = await Promise.race([
                    mermaid.render(id, chart),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("Mermaid render timeout (15s)")), RENDER_TIMEOUT_MS)
                    ),
                ]);
                console.log("[Mermaid] render done");
                setSvg(result.svg);
                setError(null);
            } catch (err) {
                console.error("[Mermaid] render error:", err);
                setError(err instanceof Error ? err.message : "Failed to render diagram");
            }
        };

        renderChart();
    }, [chart]);

    if (error) return <div className="text-red-400 text-xs">{error}</div>;
    if (!svg) return <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Rendering Viz...</div>;

    return (
        <div
            ref={ref}
            className="mermaid-container overflow-x-auto p-2 bg-[#0d1520] rounded border border-slate-800"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
};
