import mermaid from "mermaid";
import { VizPayloadV1, GraphStructure, LinkedListStructure } from "./vizPayload";

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",          // "loose" enables click callbacks on nodes
  fontFamily: "var(--font-sans)",
  flowchart: {
    curve: "basis",
    padding: 20
  }
});

/**
 * Generates Mermaid graph syntax from a visualization payload.
 * Returns a user-visible error diagram string on failure (avoids silent failure).
 */
export function vizPayloadToMermaidSource(payload: VizPayloadV1['viz']): string {
  if (!payload) return "";
  try {
    switch (payload.diagramType) {
      case "graph":
        return generateGraphDiagram(payload.structure as GraphStructure, payload.markers);
      case "linked-list":
        return generateLinkedListDiagram(payload.structure as LinkedListStructure, payload.markers);
      default:
        return `graph TD\nError[Unknown diagram type: ${payload.diagramType}]`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mermaidViz] Conversion failed:", msg);
    return `graph TD\nErr["Visualization failed: ${msg.replace(/"/g, "'").slice(0, 60)}"]`;
  }
}

/**
 * Renders Mermaid source to an SVG string.
 * @param source - Mermaid syntax source code
 * @param id - Unique ID for the diagram container
 */
export async function renderMermaidToSvg(source: string, id: string): Promise<string> {
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (error) {
    console.error("Mermaid render error:", error);
    return `<div class="text-red-400 p-4">Failed to render diagram</div>`;
  }
}

// --- Generators ---

// --- Generators ---

function generateGraphDiagram(structure: GraphStructure, markers: any): string {
  let mermaidCode = "graph TD\n";

  // Add nodes
  structure.nodes.forEach(node => {
    // Style visited/revisited nodes
    let styleClass = ":::ds-node";

    if (markers.revisitedNodes?.includes(node.id)) {
      styleClass += " graph-node--cycle"; // Use cycle style for revisited in typical DFS detection
    } else if (markers.visitedOrder?.includes(node.id)) {
      styleClass += " graph-node--visited";
    }

    // Check for "active" or "cycle" specific markers if we had them, 
    // for now we map revisited -> cycle style (often what we want to highlight)

    mermaidCode += `    ${node.id}(["${node.label || node.id}"])${styleClass}\n`;
  });

  // Add edges
  structure.edges.forEach(edge => {
    // Highlight cycle edges
    const isCycle = markers.cycleEdges?.some((ce: any) =>
      ce.from === edge.from && ce.to === edge.to
    );

    const arrow = isCycle ? "==>|Cycle|" : "-->";

    mermaidCode += `    ${edge.from} ${arrow} ${edge.to}\n`;

    // Apply class for cycle edge 
    // Note: Mermaid linkStyle is by index, which is brittle if we change order.
    // Ideally we'd use link classes, but Mermaid support varies. 
    // Falling back to inline styles for edges where critical, or linkStyle by index.
    if (isCycle) {
      // We can use the index of the edge in the list logic
      // But strictly, we need the 0-based index of the link definition in the graph
      // Since we iterate in order, it matches the structure.edges index
      const index = structure.edges.indexOf(edge);
      mermaidCode += `    linkStyle ${index} stroke:#ef4444,stroke-width:2px,stroke-dasharray: 4 2;\n`;
    } else {
      const index = structure.edges.indexOf(edge);
      mermaidCode += `    linkStyle ${index} stroke:#475569,stroke-width:2px;\n`;
    }
  });

  // Styles definitions mapping to our CSS classes
  // Note: Mermaid renders into shadow DOM or separate SVG, so global CSS classes might not apply 
  // UNLESS we use 'cssClasses' configuration or standard class definitions that match.
  // However, simpler approach for Mermaid is defining the classDef to usage the SAME visual values
  // as our CSS, OR ensuring the SVG can see the global styles (which is tricky with shadow DOM).
  // 
  // PRO TIP: We will define the classDef *inside* the mermaid string to match the requested CSS values.

  mermaidCode += `
    classDef ds-node fill:#0f172a,stroke:#334155,color:#e5e7eb,stroke-width:1px
    classDef graph-node--visited fill:#064e3b,stroke:#059669,color:#e5e7eb
    classDef graph-node--cycle fill:#1f2933,stroke:#ef4444,color:#e5e7eb,stroke-dasharray: 5 5
  `;

  return mermaidCode;
}

function generateLinkedListDiagram(structure: LinkedListStructure, markers: any): string {
  // Defensive guard: avoid runtime errors if payload is malformed
  if (!structure?.nodes || !Array.isArray(structure.nodes)) {
    return "graph LR\n    empty([No nodes]):::ds-node\n    classDef ds-node fill:#0f172a,stroke:#334155,color:#e5e7eb";
  }
  const nodes = structure.nodes;
  const nextPointers = Array.isArray(structure.nextPointers) ? structure.nextPointers : [];
  if (nodes.length === 0) {
    return `graph LR
    Start((HEAD)) --> End{∅}
    classDef null-node fill:none,stroke:#ef4444,stroke-width:2px
    class End null-node`;
  }

  // Use LR for horizontal list flow
  let mermaidCode = "graph LR\n";

  // 1. Add Nodes with Semantic Labels (HEAD/TAIL)
  nodes.forEach((node, index) => {
    const isHead = index === 0;
    const isTail = index === nodes.length - 1;
    const isUnreachable = markers.unreachableNodes?.includes(node.id);
    const isMeet = markers.meetNode === node.id;

    // Construct label with metadata sub-text
    let label = node.value || node.id;
    if (isHead) label += "<br/><small>HEAD</small>";
    if (isTail) label += "<br/><small>TAIL</small>";
    if (isUnreachable) label += "<br/><small>UNREACHABLE</small>";

    // Stadium-shaped pill nodes via ([" "])
    const styleClass = isUnreachable
      ? ":::unreachable"
      : isMeet
        ? ":::meet-node"
        : ":::ds-node";

    mermaidCode += `    ${node.id}(["${label}"])${styleClass}\n`;

    // 2. GATE 2 INTERACTION: Attach click event to trigger acknowledgment
    mermaidCode += `    click ${node.id} call mermaidNodeClick("${node.id}")\n`;
  });

  // 3. Add Pointers with Broken Reference Styling
  nextPointers.forEach((ptr, index) => {
    const isBroken = markers.brokenLinks?.some((bl: any) => bl.from === ptr.from);
    const isCycleEdge =
      markers.cycleEdge &&
      markers.cycleEdge.from === ptr.from &&
      markers.cycleEdge.to === ptr.to;

    // Broken links use dashed lines; cycle edges use dotted + label
    const arrow = isBroken
      ? "-.->|BROKEN|"
      : isCycleEdge
        ? "-.->|Cycle|"
        : "-->";

    mermaidCode += `    ${ptr.from} ${arrow} ${ptr.to}\n`;

    if (isBroken || isCycleEdge) {
      mermaidCode += `    linkStyle ${index} stroke:#ef4444,stroke-width:3px,stroke-dasharray: 5 5;\n`;
    } else {
      mermaidCode += `    linkStyle ${index} stroke:#475569,stroke-width:2px;\n`;
    }
  });

  // 4. CSS Class Definitions — rounded pills with glow effects
  mermaidCode += `
    classDef ds-node fill:#0f172a,stroke:#38bdf8,color:#f8fafc,stroke-width:2px
    classDef meet-node fill:#3f1d1d,stroke:#ef4444,color:#e5e7eb
    classDef unreachable fill:#1e293b,stroke:#ef4444,color:#94a3b8,opacity:0.5,stroke-dasharray: 5 5
  `;

  return mermaidCode;
}
