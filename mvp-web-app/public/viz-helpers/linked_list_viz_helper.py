
import json
import sys

# === VIZ HELPER ===
def print_linked_list_viz(head, visited_nodes=None, cycle_node=None, cycle_edge=None, meet_node=None):
    """
    Prints a JSON payload for the Linked List Debugger.
    
    Args:
        head: The head node of the linked list (assumed to have .val and .next)
        visited_nodes (list): List of node IDs/Values visited
        cycle_node: The node where a cycle begins (if any)
        cycle_edge: Tuple/Dict {"from": u, "to": v}
        meet_node: The node where slow/fast pointers met
    """
    
    nodes = []
    pointers = []
    
    curr = head
    seen = set()
    node_map = {} # id -> node
    
    # Safety limit to prevent infinite loops during traversal if cycle exists and not handled
    steps = 0
    max_steps = 100
    
    while curr and steps < max_steps:
        # Use python's id() as unique identifier if no specialized id
        # But for stability in testing, maybe use val if unique, or just id()
        node_id = str(id(curr))
        
        if node_id in seen:
            # We hit a cycle we've seen in this traversal
            # Add the edge closing the cycle and stop
            pointers.append({"from": str(id(prev)), "to": node_id})
            break
            
        seen.add(node_id)
        nodes.append({"id": node_id, "value": str(curr.val)})
        
        if curr.next:
            pointers.append({"from": node_id, "to": str(id(curr.next))})
            
        prev = curr
        curr = curr.next
        steps += 1
        
    payload = {
        "diagramType": "linked-list",
        "structure": {
            "nodes": nodes,
            "nextPointers": pointers
        },
        "markers": {
            "cycleDetected": cycle_node is not None,
            "meetNode": str(id(meet_node)) if meet_node else None,
            "cycleEdge": cycle_edge
        }
    }
    
    print("\n=== VIZ_PAYLOAD_START ===")
    print(json.dumps(payload))
    print("=== VIZ_PAYLOAD_END ===\n")
