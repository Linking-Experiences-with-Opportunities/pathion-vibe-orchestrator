"use client";

import React from "react";
import { Mermaid } from "@/components/Mermaid";
import { vizPayloadToMermaidSource } from "@/lib/mermaidViz";
import { ArrayViz } from "./ArrayViz";
import { TreeViz } from "./TreeViz";
import { LinkedListViz } from "./LinkedListViz"; // [NEW]
import type {
  VizPayloadV1,
  TreeStructure,
  ArrayStructure,
  HeapStructure,
  LinkedListStructure,
} from "@/lib/vizPayload";

interface DataStructureVizProps {
  viz: VizPayloadV1["viz"] | null;
}

/**
 * Unified dispatcher component that receives a viz payload and routes
 * to the correct renderer based on `diagramType`.
 *
 * - "linked-list"           -> Scrollable Flexbox LinkedListViz
 * - "tree"                  -> SVG-based TreeViz
 * - "heap"                  -> SVG-based TreeViz (heap is rendered as tree)
 * - "array"                 -> div-based ArrayViz
 * - "graph"                 -> Mermaid (fallback for complex graphs)
 */
function isLinkedListStructure(
  structure: unknown
): structure is LinkedListStructure {
  return (
    typeof structure === "object" &&
    structure !== null &&
    "nodes" in structure &&
    "nextPointers" in structure &&
    Array.isArray((structure as { nodes: unknown[] }).nodes) &&
    Array.isArray((structure as { nextPointers: unknown[] }).nextPointers)
  );
}

export const DataStructureViz: React.FC<DataStructureVizProps> = ({ viz }) => {
  if (!viz) return null;

  // Safety override: if payload has linked-list shape but type was set to array, use linked-list
  const resolvedDiagramType =
    viz.diagramType === "array" && isLinkedListStructure(viz.structure)
      ? "linked-list"
      : viz.diagramType;

  switch (resolvedDiagramType) {
    case "linked-list": {
      // Use new scrolling viz
      if (isLinkedListStructure(viz.structure)) {
        return (
          <LinkedListViz
            structure={viz.structure}
            markers={viz.markers}
          />
        );
      }
      // Fallback to mermaid if structure doesn't match type guard for some reason
      const vizForMermaid = { ...viz, diagramType: resolvedDiagramType };
      const source = vizPayloadToMermaidSource(vizForMermaid);
      return source ? <Mermaid chart={source} /> : null;
    }

    case "graph": {
      const vizForMermaid = { ...viz, diagramType: resolvedDiagramType };
      const source = vizPayloadToMermaidSource(vizForMermaid);
      if (!source) return null;
      // Show error diagram if conversion returned an error node (visible failure, not silent)
      if (source.includes("Visualization failed:") || source.includes("Error[")) {
        return (
          <div className="p-3 bg-amber-950/30 border border-amber-700/50 rounded-lg text-amber-200 text-xs">
            Diagram could not be generated. Check console for details.
            <div className="mt-2">
              <Mermaid chart={source} />
            </div>
          </div>
        );
      }
      return <Mermaid chart={source} />;
    }

    case "tree": {
      return (
        <TreeViz
          structure={viz.structure as TreeStructure}
          markers={viz.markers as Record<string, unknown>}
        />
      );
    }

    case "heap": {
      // Heaps render as trees -- HeapStructure extends TreeStructure
      const heapStruct = viz.structure as HeapStructure;
      return (
        <div className="flex flex-col gap-2">
          <TreeViz
            structure={heapStruct}
            markers={viz.markers as Record<string, unknown>}
          />
          {/* Show the underlying array representation if available */}
          {heapStruct.arrayRepresentation &&
            heapStruct.arrayRepresentation.length > 0 && (
              <ArrayViz
                structure={{
                  name: `${heapStruct.heapType || ""}heap (array)`,
                  elements: heapStruct.arrayRepresentation.map((v, i) => ({
                    index: i,
                    value: v,
                  })),
                  is2D: false,
                }}
                markers={viz.markers as Record<string, unknown>}
              />
            )}
        </div>
      );
    }

    case "array": {
      return (
        <ArrayViz
          structure={viz.structure as ArrayStructure}
          markers={viz.markers as Record<string, unknown>}
        />
      );
    }

    default: {
      // Fallback: attempt Mermaid rendering for unknown types
      try {
        const vizForMermaid = { ...viz, diagramType: resolvedDiagramType };
        const source = vizPayloadToMermaidSource(vizForMermaid);
        if (source) return <Mermaid chart={source} />;
      } catch {
        // If Mermaid conversion fails, show a graceful fallback
      }
      return (
        <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 text-zinc-500 text-xs">
          Unsupported diagram type: {resolvedDiagramType}
        </div>
      );
    }
  }
};
