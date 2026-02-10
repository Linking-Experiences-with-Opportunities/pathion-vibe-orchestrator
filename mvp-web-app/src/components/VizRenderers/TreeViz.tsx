"use client";

import React, { useMemo } from "react";
import { TreeStructure } from "@/lib/vizPayload";

interface TreeVizProps {
  structure: TreeStructure;
  markers?: Record<string, unknown>;
}

// Layout constants
const NODE_RADIUS = 22;
const ROW_HEIGHT = 70;
const MIN_H_SPACING = 56;
const PADDING_X = 40;
const PADDING_Y = 40;

interface LayoutNode {
  id: string;
  value: string;
  label?: string;
  x: number;
  y: number;
  depth: number;
}

interface LayoutEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
}

/**
 * Build an adjacency list from edges, treating the first edge from each parent
 * as defining the tree structure. Supports both binary and n-ary trees.
 */
function buildAdjacency(
  structure: TreeStructure
): Map<string, { childId: string; label?: string }[]> {
  const adj = new Map<string, { childId: string; label?: string }[]>();
  for (const edge of structure.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push({ childId: edge.to, label: edge.label });
  }
  return adj;
}

/**
 * Count total leaf descendants (or 1 if leaf) for subtree width calculation.
 */
function countLeaves(
  nodeId: string,
  adj: Map<string, { childId: string; label?: string }[]>,
  visited: Set<string>
): number {
  if (visited.has(nodeId)) return 0;
  visited.add(nodeId);

  const children = adj.get(nodeId);
  if (!children || children.length === 0) return 1;

  let total = 0;
  for (const child of children) {
    total += countLeaves(child.childId, adj, visited);
  }
  return total || 1;
}

/**
 * Recursive layout: positions nodes by their subtree width.
 */
function layoutTree(
  nodeId: string,
  depth: number,
  leftX: number,
  adj: Map<string, { childId: string; label?: string }[]>,
  nodeMap: Map<string, { value: string; label?: string }>,
  visited: Set<string>,
  resultNodes: LayoutNode[],
  resultEdges: LayoutEdge[]
): number {
  if (visited.has(nodeId)) return leftX;
  visited.add(nodeId);

  const nodeInfo = nodeMap.get(nodeId);
  if (!nodeInfo) return leftX;

  const children = adj.get(nodeId) ?? [];
  const leafCount = countLeaves(nodeId, adj, new Set(visited));
  const subtreeWidth = Math.max(leafCount * MIN_H_SPACING, MIN_H_SPACING);

  if (children.length === 0) {
    // Leaf node
    const x = leftX + MIN_H_SPACING / 2;
    const y = PADDING_Y + depth * ROW_HEIGHT;
    resultNodes.push({
      id: nodeId,
      value: nodeInfo.value,
      label: nodeInfo.label,
      x,
      y,
      depth,
    });
    return leftX + MIN_H_SPACING;
  }

  // Layout children first so we know their positions
  let currentLeft = leftX;
  const childPositions: { childId: string; x: number; y: number }[] = [];

  for (const child of children) {
    const childNodesBefore = resultNodes.length;
    const nextLeft = layoutTree(
      child.childId,
      depth + 1,
      currentLeft,
      adj,
      nodeMap,
      visited,
      resultNodes,
      resultEdges
    );

    // Find the child node we just laid out
    const childNode = resultNodes.find(
      (n, i) => i >= childNodesBefore && n.id === child.childId
    );
    if (childNode) {
      childPositions.push({
        childId: child.childId,
        x: childNode.x,
        y: childNode.y,
      });
    }

    currentLeft = nextLeft;
  }

  // Parent x = average of children x
  const parentX =
    childPositions.length > 0
      ? childPositions.reduce((sum, c) => sum + c.x, 0) /
        childPositions.length
      : leftX + subtreeWidth / 2;
  const parentY = PADDING_Y + depth * ROW_HEIGHT;

  resultNodes.push({
    id: nodeId,
    value: nodeInfo.value,
    label: nodeInfo.label,
    x: parentX,
    y: parentY,
    depth,
  });

  // Create edges from parent to children
  for (let i = 0; i < children.length; i++) {
    const cp = childPositions[i];
    if (cp) {
      resultEdges.push({
        fromX: parentX,
        fromY: parentY,
        toX: cp.x,
        toY: cp.y,
        label: children[i].label,
      });
    }
  }

  return currentLeft;
}

export const TreeViz: React.FC<TreeVizProps> = ({ structure, markers }) => {
  const layout = useMemo(() => {
    if (
      !structure ||
      !structure.nodes ||
      structure.nodes.length === 0
    ) {
      return null;
    }

    // Build node map
    const nodeMap = new Map<string, { value: string; label?: string }>();
    for (const node of structure.nodes) {
      nodeMap.set(node.id, { value: node.value, label: node.label });
    }

    // Build adjacency
    const adj = buildAdjacency(structure);

    // Find root
    const rootId = structure.rootId || structure.nodes[0]?.id;
    if (!rootId || !nodeMap.has(rootId)) return null;

    const layoutNodes: LayoutNode[] = [];
    const layoutEdges: LayoutEdge[] = [];
    const visited = new Set<string>();

    layoutTree(
      rootId,
      0,
      0,
      adj,
      nodeMap,
      visited,
      layoutNodes,
      layoutEdges
    );

    // Also layout any disconnected nodes (not reachable from root)
    for (const node of structure.nodes) {
      if (!visited.has(node.id)) {
        layoutTree(
          node.id,
          0,
          layoutNodes.length > 0
            ? Math.max(...layoutNodes.map((n) => n.x)) + MIN_H_SPACING
            : 0,
          adj,
          nodeMap,
          visited,
          layoutNodes,
          layoutEdges
        );
      }
    }

    return { nodes: layoutNodes, edges: layoutEdges };
  }, [structure]);

  if (!layout || layout.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-zinc-500 text-xs italic">
        Empty tree
      </div>
    );
  }

  // Compute SVG dimensions
  const maxX = Math.max(...layout.nodes.map((n) => n.x)) + PADDING_X;
  const maxY = Math.max(...layout.nodes.map((n) => n.y)) + PADDING_Y;
  const svgWidth = maxX + PADDING_X;
  const svgHeight = maxY + PADDING_Y;

  // Extract visited order from markers
  const visitedOrder: string[] =
    markers && Array.isArray((markers as Record<string, unknown>).visitedOrder)
      ? ((markers as Record<string, unknown>).visitedOrder as string[])
      : [];
  const visitedSet = new Set(visitedOrder);

  // Root ID for special styling
  const rootId = structure.rootId || structure.nodes[0]?.id;

  return (
    <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-x-auto custom-scrollbar">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="block mx-auto"
      >
        {/* Edges */}
        {layout.edges.map((edge, i) => {
          // Shorten line so it doesn't overlap with node circles
          const dx = edge.toX - edge.fromX;
          const dy = edge.toY - edge.fromY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const ratio = dist > 0 ? NODE_RADIUS / dist : 0;

          const x1 = edge.fromX + dx * ratio;
          const y1 = edge.fromY + dy * ratio;
          const x2 = edge.toX - dx * ratio;
          const y2 = edge.toY - dy * ratio;

          const midX = (edge.fromX + edge.toX) / 2;
          const midY = (edge.fromY + edge.toY) / 2;

          return (
            <g key={`edge-${i}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#64748b"
                strokeWidth={2}
              />
              {edge.label && (
                <text
                  x={midX}
                  y={midY - 6}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((node) => {
          const isRoot = node.id === rootId;
          const isVisited = visitedSet.has(node.id);
          const radius = isRoot ? NODE_RADIUS + 2 : NODE_RADIUS;

          // Color logic
          let fillColor = "#3f3f46"; // zinc-700
          let strokeColor = "#a1a1aa"; // zinc-400
          let strokeWidth = 1.5;

          if (isVisited) {
            fillColor = "#1e3a5f"; // blue tint
            strokeColor = "#3b82f6"; // blue-500
            strokeWidth = 2;
          }

          if (isRoot) {
            strokeWidth = 2.5;
            strokeColor = isVisited ? "#3b82f6" : "#d4d4d8"; // zinc-300 or blue
          }

          return (
            <g key={`node-${node.id}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
              />
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#f4f4f5"
                fontSize={12}
                fontWeight={600}
                fontFamily="monospace"
              >
                {node.value.length > 4
                  ? node.value.slice(0, 3) + "\u2026"
                  : node.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
