"use client";

import React from "react";
import { ArrayStructure } from "@/lib/vizPayload";

interface ArrayVizProps {
  structure: ArrayStructure;
  markers?: Record<string, unknown>;
}

/** Map highlight state to Tailwind background classes */
function highlightBg(highlight?: string): string {
  switch (highlight) {
    case "active":
      return "bg-blue-600/40 border-blue-500";
    case "compared":
      return "bg-yellow-600/40 border-yellow-500";
    case "swapped":
      return "bg-orange-600/40 border-orange-500";
    case "sorted":
      return "bg-green-600/40 border-green-500";
    default:
      return "bg-zinc-800 border-zinc-600";
  }
}

/** Render a single row of array cells */
function ArrayRow({
  elements,
  pointers,
  rowLabel,
}: {
  elements: { index: number; value: string; highlight?: string }[];
  pointers?: Record<string, number>;
  rowLabel?: string;
}) {
  // Build a reverse map: index -> pointer names
  const pointersByIndex: Record<number, string[]> = {};
  if (pointers) {
    for (const [name, idx] of Object.entries(pointers)) {
      if (typeof idx === "number") {
        if (!pointersByIndex[idx]) pointersByIndex[idx] = [];
        pointersByIndex[idx].push(name);
      }
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      {rowLabel != null && (
        <div className="text-[10px] text-zinc-500 font-mono mb-0.5">
          Row {rowLabel}
        </div>
      )}
      <div className="flex items-start">
        {elements.map((el) => {
          const ptrs = pointersByIndex[el.index];
          return (
            <div key={el.index} className="flex flex-col items-center">
              {/* Cell */}
              <div
                className={`
                  flex flex-col items-center justify-center
                  min-w-[44px] h-[52px] px-2
                  border text-center
                  transition-colors duration-150
                  ${highlightBg(el.highlight)}
                  ${el.index === 0 ? "rounded-l-md" : ""}
                  ${el.index === elements.length - 1 ? "rounded-r-md" : ""}
                `}
              >
                <span className="text-sm font-semibold text-zinc-100 font-mono leading-tight">
                  {el.value}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono leading-tight">
                  [{el.index}]
                </span>
              </div>

              {/* Pointer annotations */}
              {ptrs && ptrs.length > 0 && (
                <div className="flex flex-col items-center mt-0.5">
                  <span className="text-[10px] text-blue-400 leading-none select-none">
                    &#8593;
                  </span>
                  <span className="text-[10px] text-blue-300 font-mono font-semibold leading-tight">
                    {ptrs.join(", ")}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ArrayViz: React.FC<ArrayVizProps> = ({ structure, markers }) => {
  if (!structure) return null;

  const pointers =
    markers && typeof markers === "object" && "pointers" in markers
      ? (markers.pointers as Record<string, number> | undefined)
      : undefined;

  // 2D array rendering
  if (structure.is2D && structure.rows && structure.rows.length > 0) {
    return (
      <div className="flex flex-col gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-x-auto">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300">
            {structure.name || "Array"}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {structure.rows.length} x{" "}
            {structure.rows[0]?.elements?.length ?? 0}
          </span>
        </div>

        {/* Grid of rows */}
        <div className="flex flex-col gap-2 overflow-x-auto custom-scrollbar">
          {structure.rows.map((row) => (
            <ArrayRow
              key={row.index}
              elements={row.elements}
              rowLabel={String(row.index)}
            />
          ))}
        </div>
      </div>
    );
  }

  // 1D array rendering
  const elements = structure.elements ?? [];
  const needsScroll = elements.length > 20;

  return (
    <div className="flex flex-col gap-2 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-300">
          {structure.name || "Array"}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">
          length: {elements.length}
        </span>
      </div>

      {/* Array cells */}
      <div
        className={`${
          needsScroll ? "overflow-x-auto custom-scrollbar" : ""
        }`}
      >
        {elements.length === 0 ? (
          <div className="text-xs text-zinc-500 italic py-2">Empty array</div>
        ) : (
          <ArrayRow elements={elements} pointers={pointers} />
        )}
      </div>
    </div>
  );
};
