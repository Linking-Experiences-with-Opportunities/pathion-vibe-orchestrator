import { UniversalErrorCode } from "./errorCodeMapper";

export type VizDiagramType = "graph" | "linked-list" | "tree" | "array" | "heap";

export interface GraphStructure {
  nodes: { id: string; label?: string; style?: string }[];
  edges: { from: string; to: string; label?: string; style?: string }[];
}

export interface LinkedListStructure {
  nodes: { id: string; value?: string; label?: string }[];
  nextPointers: { from: string; to: string; label?: string }[];
}

export interface TreeStructure {
  nodes: { id: string; value: string; label?: string }[];
  edges: { from: string; to: string; label?: string }[];
  rootId: string;
}

export interface ArrayStructure {
  name: string;
  elements: { index: number; value: string; highlight?: "active" | "compared" | "swapped" | "sorted" }[];
  is2D: boolean;
  rows?: { index: number; elements: { index: number; value: string; highlight?: string }[] }[];
}

export interface HeapStructure extends TreeStructure {
  heapType: "min" | "max";
  arrayRepresentation: string[];
}

export type VizStructure =
  | GraphStructure
  | LinkedListStructure
  | TreeStructure
  | ArrayStructure
  | HeapStructure;

// ---- State Snapshot types (invariant extraction) ----

export interface LinkedListSnapshot {
  type: "linked-list";
  headExists: boolean;
  tailExists: boolean;
  tailNextIsNull: boolean | null;
  tailIsLastReachable: boolean | null;
  storedSize: number | null;
  reachableNodes: number;
  cycleDetected: boolean;
}

export interface ArrayListSnapshot {
  type: "arraylist";
  storedSize: number | null;
  capacity: number | null;
  bufferPreview: string[] | null;
  sizeInRange: boolean | null;
}

export interface CircularQueueSnapshot {
  type: "circular-queue";
  headIndex: number | null;
  tailIndex: number | null;
  storedSize: number | null;
  capacity: number | null;
  bufferPreview: string[] | null;
  indicesInRange: boolean | null;
  sizeInRange: boolean | null;
}

export type StateSnapshot =
  | LinkedListSnapshot
  | ArrayListSnapshot
  | CircularQueueSnapshot;

// ---- Viz Markers ----

export interface VizMarkers {
  visitedOrder?: string[];
  revisitedNodes?: string[];
  cycleEdges?: { from: string; to: string }[];
  maxDepth?: number;
  terminated?: boolean;
  cycleDetected?: boolean;
  meetNode?: string;
  cycleEdge?: { from: string; to: string };
  pointers?: Record<string, number>;
  unreachableNodes?: string[];
  brokenLinks?: { from: string; to: string }[];
}

export interface VizPayloadV1 {
  version: "1";
  testName: string;
  errorCode: UniversalErrorCode;
  vizEligible: boolean;
  viz?: {
    diagramType: VizDiagramType;
    structure: VizStructure;
    markers: VizMarkers;
    stateSnapshot?: StateSnapshot;
    expectedSummary?: string;
    actualSummary?: string;
    truncated?: boolean;
  };
}
