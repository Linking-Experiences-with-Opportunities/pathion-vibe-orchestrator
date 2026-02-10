
import json
import sys

# === VIZ HELPER ===
def print_graph_viz(adjacency_list, visited_order=None, revisited_nodes=None, cycle_edges=None, truncated=False):
    """
    Prints a JSON payload for the Mermaid Debugger Visualization.
    
    Args:
        adjacency_list (dict): Dict mapping node_id -> list of neighbor_ids
        visited_order (list): List of node_ids in order of visitation
        revisited_nodes (list): List of node_ids that were visited again (e.g. cycle detection)
        cycle_edges (list): List of tuples/dicts {"from": u, "to": v} representing back-edges
        truncated (bool): Whether the graph was truncated due to size limits
    """
    
    nodes = []
    edges = []
    
    # Extract all unique nodes
    unique_nodes = set(adjacency_list.keys())
    for neighbors in adjacency_list.values():
        unique_nodes.update(neighbors)
    
    # Sort for deterministic output
    sorted_nodes = sorted(list(unique_nodes), key=str)
        
    for node in sorted_nodes:
        nodes.append({"id": str(node), "label": str(node)})
        
    for u, neighbors in adjacency_list.items():
        if u not in unique_nodes:
            continue
        for v in neighbors:
            if v in unique_nodes:
                edges.append({"from": str(u), "to": str(v)})
            
    payload = {
        "diagramType": "graph",
        "structure": {
            "nodes": nodes,
            "edges": edges
        },
        "markers": {
            "visitedOrder": [str(x) for x in (visited_order or []) if x in unique_nodes],
            "revisitedNodes": [str(x) for x in (revisited_nodes or []) if x in unique_nodes],
            "cycleEdges": cycle_edges or []
        },
        "truncated": truncated
    }
    

    print("\n=== VIZ_PAYLOAD_START ===")
    print(json.dumps(payload))
    print("=== VIZ_PAYLOAD_END ===\n")

def dump_viz(locals_dict):
    """
    Auto-discovers graph/list structures in the locals_dict and prints the visualization.
    Scans for:
    1. Explicit adjacency lists (dict)
    2. Object-based graphs (objects with .next, .neighbors, .children)
    """
    # Heuristic 1: Look for adjacency list dicts
    adjacency_list = None
    visited_order = None
    is_truncated = False
    
    # Common variable names for graphs
    for name in ['graph', 'adj', 'adjacency_list', 'g']:
        if name in locals_dict:
            val = locals_dict[name]
            if isinstance(val, dict):
                adjacency_list = val
                break
                
    # If no explicit graph, scan for any dict that looks like a graph
    if not adjacency_list:
        for name, val in locals_dict.items():
            if isinstance(val, dict) and len(val) > 0:
                first_val = next(iter(val.values()))
                if isinstance(first_val, list):
                    adjacency_list = val
                    break
    
    # Heuristic 2: Object-based graph crawling
    if not adjacency_list:
        roots = []
        # Scan locals for objects that look like nodes
        for name, val in locals_dict.items():
            if hasattr(val, 'next') or hasattr(val, 'neighbors') or hasattr(val, 'children') or hasattr(val, 'left') or hasattr(val, 'right'):
                # Prioritize 'head' or 'root' if present
                if name in ['head', 'root', 'start']:
                    roots.insert(0, val)
                else:
                    roots.append(val)
        
        if roots:
            # Crawl from the first likely root
            # We construct an adjacency list from the object graph
            curr_adj = {}
            queue = [roots[0]]
            seen_objs = {id(roots[0]): roots[0]} 
            # Limit traversal
            MAX_NODES = 20
            
            while queue and len(seen_objs) <= MAX_NODES:
                curr = queue.pop(0)
                curr_id = str(curr.val) if hasattr(curr, 'val') else str(id(curr))
                
                if curr_id not in curr_adj:
                    curr_adj[curr_id] = []
                
                neighbors = []
                # Check .next (Linked List)
                if hasattr(curr, 'next') and curr.next:
                     neighbors.append(curr.next)
                
                # Check .neighbors (Graph)
                if hasattr(curr, 'neighbors') and isinstance(curr.neighbors, list):
                    neighbors.extend(curr.neighbors)
                    
                # Check .left / .right (Tree)
                if hasattr(curr, 'left') and curr.left:
                    neighbors.append(curr.left)
                if hasattr(curr, 'right') and curr.right:
                    neighbors.append(curr.right)
                    
                for n in neighbors:
                    n_id = str(n.val) if hasattr(n, 'val') else str(id(n))
                    curr_adj[curr_id].append(n_id)
                    
                    if id(n) not in seen_objs:
                        # Stop if we hit limit
                        if len(seen_objs) >= MAX_NODES:
                            is_truncated = True
                            continue # Don't add to queue, effectively truncating
                        
                        seen_objs[id(n)] = n
                        queue.append(n)
            
            adjacency_list = curr_adj

    # Look for visited set/list
    for name in ['visited', 'path', 'seen']:
        if name in locals_dict:
            val = locals_dict[name]
            if isinstance(val, (list, set)):
                visited_order = list(val)
                break

    if adjacency_list:
        try:
            print_graph_viz(adjacency_list, visited_order=visited_order, truncated=is_truncated)
        except Exception as e:
            # Fallback or silent fail if viz generation fails
            pass
