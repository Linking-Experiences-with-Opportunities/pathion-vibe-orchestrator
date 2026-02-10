/**
 * Pyodide Worker Code - Expanded Visualization Edition
 * This file uses a modular string-based architecture to allow for clean logic
 * while exporting a single Blob-compatible string for the Web Worker.
 */

// ========================================================
// SECTION 1: WORKER INFRASTRUCTURE & POLYFILLS
// ========================================================
const WORKER_SETUP = `
console.log('[WORKER] ========================================');
console.log('[WORKER] Booting Pyodide Worker Environment...');
console.log('[WORKER] ========================================');

if (!Object.hasOwn) {
  Object.hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
}

const EXIT_OK = 0, EXIT_TIMEOUT = 124, EXIT_MEMORY = 137, EXIT_ERROR = 1;

// ---- Output size limits (characters) ----
const MAX_STDOUT = 20000;
const MAX_STDERR = 10000;

// ---- VIZ payload markers ----
const VIZ_START_MARKER = '=== VIZ_PAYLOAD_START ===';
const VIZ_END_MARKER = '=== VIZ_PAYLOAD_END ===';

self.addEventListener('error', (e) => {
  console.error('[WORKER UNCAUGHT ERROR]', e.error || e.message, e);
  self.postMessage({ cmd: 'ERROR', error: e.error?.stack || e.message });
});

self.addEventListener('unhandledrejection', (e) => {
  console.error('[WORKER UNHANDLED PROMISE REJECTION]', e.reason);
  self.postMessage({ cmd: 'ERROR', error: String(e.reason) });
});

console.log('[WORKER] Error handlers registered');
`;

// ========================================================
// SECTION 2: PYTHON BRIDGE & VIZ ENGINE
// These are Python code blocks that will be loaded into Pyodide
// ========================================================
const PYTHON_MODULES = `
import sys, io, traceback, time, re, json, collections

class OutputCapture:
    def __init__(self):
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()
        self.original_stdout = sys.stdout
        self.original_stderr = sys.stderr

    def __enter__(self):
        sys.stdout = self.stdout
        sys.stderr = self.stderr
        return self

    def __exit__(self, *args):
        sys.stdout = self.original_stdout
        sys.stderr = self.original_stderr

    def get_output(self):
        return self.stdout.getvalue(), self.stderr.getvalue()

class VizSerializer:
    def __init__(self, max_nodes=50):
        self.nodes = []
        self.edges = []
        self.seen_ids = set()
        self.max_nodes = max_nodes
        self._array_data = {}  # name -> {data, is_2d} for typed structure conversion

    def add_node(self, id_val, label, type_name):
        if id_val not in self.seen_ids and len(self.nodes) < self.max_nodes:
            self.nodes.append({"id": str(id_val), "label": str(label), "type": type_name})
            self.seen_ids.add(id_val)
            return True
        return id_val in self.seen_ids

    def add_edge(self, u, v, label=""):
        self.edges.append({"from": str(u), "to": str(v), "label": label})

    def serialize_array(self, name, data):
        is_2d = all(isinstance(x, (list, tuple)) for x in data if x) if data else False
        label = f"{name} (2D Array)" if is_2d else f"{name} (Array)"
        val_str = str(data)
        if len(val_str) > 50:
            val_str = val_str[:47] + "..."
        self.add_node(name, f"{label}: {val_str}", "array")
        self._array_data[name] = {"data": data, "is_2d": is_2d}

    def serialize_linked_list(self, name, head):
        curr = head
        prev_id = None
        count = 0
        while curr and count < self.max_nodes:
            curr_id = str(id(curr))
            val = getattr(curr, 'val', getattr(curr, 'value', getattr(curr, 'data', '?')))
            self.add_node(curr_id, str(val), "ll_node")
            if prev_id:
                self.add_edge(prev_id, curr_id)
            prev_id = curr_id
            curr = getattr(curr, 'next', None)
            count += 1

    def serialize_tree(self, root):
        if not root or len(self.nodes) >= self.max_nodes: return
        r_id = str(id(root))
        val = getattr(root, 'val', getattr(root, 'value', getattr(root, 'data', '?')))
        if self.add_node(r_id, str(val), "tree_node"):
            for side in ['left', 'right']:
                child = getattr(root, side, None)
                if child:
                    self.add_edge(r_id, str(id(child)), side)
                    self.serialize_tree(child)

    def serialize_heap(self, name, data):
        for i in range(len(data)):
            node_id = f"{name}_{i}"
            val_str = str(data[i])
            self.add_node(node_id, val_str, "heap_node")
            left, right = 2*i + 1, 2*i + 2
            if left < len(data):
                self.add_edge(node_id, f"{name}_{left}")
            if right < len(data):
                self.add_edge(node_id, f"{name}_{right}")

    def serialize_graph(self, adj):
        if isinstance(adj, dict):
            for u, neighbors in adj.items():
                u_id = str(u)
                self.add_node(u_id, str(u), "graph_node")
                if isinstance(neighbors, (list, set, tuple)):
                    for v in neighbors:
                        v_id = str(v)
                        self.add_node(v_id, str(v), "graph_node")
                        self.add_edge(u_id, v_id)

    def serialize_trie(self, root, prefix=""):
        if not root or len(self.nodes) >= self.max_nodes: return
        r_id = str(id(root))
        is_end = getattr(root, 'is_end', getattr(root, 'isEnd', False))
        label = f"TrieNode({prefix})" if not is_end else f"TrieNode({prefix})*"
        if self.add_node(r_id, label, "trie_node"):
            children = getattr(root, 'children', {})
            if isinstance(children, dict):
                for char, child in children.items():
                    if child:
                        self.add_edge(r_id, str(id(child)), char)
                        self.serialize_trie(child, prefix + char)
            elif isinstance(children, list):
                for i, child in enumerate(children):
                    if child:
                        char = chr(ord('a') + i)
                        self.add_edge(r_id, str(id(child)), char)
                        self.serialize_trie(child, prefix + char)

    # ---- Typed structure conversion ----
    def to_typed_structure(self, detected_type):
        """Convert flat nodes/edges into a type-specific structure shape."""
        try:
            if detected_type == "array" and self._array_data:
                # Use the first array's data for the typed structure
                first_name = next(iter(self._array_data))
                arr_info = self._array_data[first_name]
                data = arr_info["data"]
                is_2d = arr_info["is_2d"]
                if is_2d:
                    rows = []
                    for ri, row in enumerate(data):
                        if isinstance(row, (list, tuple)):
                            rows.append({
                                "index": ri,
                                "elements": [{"index": ci, "value": str(v)} for ci, v in enumerate(row)]
                            })
                    return {"name": first_name, "elements": [], "is2D": True, "rows": rows}
                else:
                    elements = [{"index": i, "value": str(v)} for i, v in enumerate(data)]
                    return {"name": first_name, "elements": elements, "is2D": False}

            elif detected_type == "tree":
                # Find root: a node that is never a target of any edge
                edge_targets = set(e["to"] for e in self.edges)
                root_candidates = [n for n in self.nodes if n["id"] not in edge_targets]
                root_id = root_candidates[0]["id"] if root_candidates else (self.nodes[0]["id"] if self.nodes else "")
                nodes_out = [{"id": n["id"], "value": n["label"], "label": n.get("label")} for n in self.nodes]
                edges_out = [{"from": e["from"], "to": e["to"], "label": e.get("label", "")} for e in self.edges]
                return {"nodes": nodes_out, "edges": edges_out, "rootId": root_id}

            elif detected_type == "linked-list":
                nodes_out = [{"id": n["id"], "value": n["label"], "label": n.get("label")} for n in self.nodes]
                next_ptrs = [{"from": e["from"], "to": e["to"], "label": e.get("label", "")} for e in self.edges]
                return {"nodes": nodes_out, "nextPointers": next_ptrs}

            else:
                # graph or fallback: keep existing {nodes, edges} format
                return {"nodes": self.nodes, "edges": self.edges}

        except Exception:
            # Fallback: return flat format on any conversion error
            return {"nodes": self.nodes, "edges": self.edges}

    # ---- Auto-detect markers from execution namespace ----
    def get_markers(self, locals_dict):
        """Auto-detect visited sets, pointer variables, and cycle indicators."""
        markers = {}
        try:
            # Auto-detect visited/seen/path/order sets or lists
            for vname in ['visited', 'seen', 'path', 'order']:
                if vname in locals_dict:
                    val = locals_dict[vname]
                    if isinstance(val, (list, set, tuple)):
                        markers['visitedOrder'] = [str(x) for x in val]
                        break

            # Auto-detect pointer variables (common index/pointer names)
            pointers = {}
            for pname in ['i', 'j', 'left', 'right', 'slow', 'fast', 'lo', 'hi', 'mid', 'current', 'prev']:
                if pname in locals_dict:
                    val = locals_dict[pname]
                    if isinstance(val, int):
                        pointers[pname] = val
            if pointers:
                markers['pointers'] = pointers

            # Auto-detect cycle indicators
            for k in locals_dict:
                if 'cycle' in str(k).lower():
                    val = locals_dict[k]
                    if isinstance(val, bool) and val:
                        markers['cycleDetected'] = True
                        break
                    elif val is not None and not isinstance(val, bool):
                        markers['cycleDetected'] = True
                        break
        except Exception:
            pass  # Never crash on marker detection
        return markers

# ---- Invariant extraction for data structure instances ----
def _extract_linked_list(instance):
    """Extract invariants from a LinkedList-like instance."""
    print("[INVARIANT:ll] Extracting linked-list invariants from " + type(instance).__name__, file=sys.stderr)
    head = getattr(instance, 'head', None)
    tail = getattr(instance, 'tail', None)
    stored_size = None
    size_attr_used = None
    for attr in ['size', '_size', 'size_', 'length', '_length']:
        if hasattr(instance, attr):
            val = getattr(instance, attr)
            stored_size = val() if callable(val) else val
            size_attr_used = attr
            break
    print("[INVARIANT:ll] head=" + ('exists' if head else 'None') + " tail=" + ('exists' if tail else 'None') + " storedSize=" + str(stored_size) + " attr=" + str(size_attr_used), file=sys.stderr)

    # Traverse with cycle guard (visited set + step limit)
    reachable = 0
    last_node = None
    seen = set()
    curr = head
    while curr and id(curr) not in seen and reachable < 200:
        seen.add(id(curr))
        last_node = curr
        reachable += 1
        curr = getattr(curr, 'next', None)
    cycle_detected = curr is not None and id(curr) in seen

    tail_next_is_null = (getattr(tail, 'next', 'MISSING') is None) if tail else None
    tail_is_last = (tail is last_node) if tail and last_node else None
    print("[INVARIANT:ll] reachable=" + str(reachable) + " cycle=" + str(cycle_detected) + " tailNextIsNull=" + str(tail_next_is_null) + " tailIsLast=" + str(tail_is_last), file=sys.stderr)

    result = {
        "type": "linked-list",
        "headExists": head is not None,
        "tailExists": tail is not None,
        "tailNextIsNull": tail_next_is_null,
        "tailIsLastReachable": tail_is_last,
        "storedSize": stored_size,
        "reachableNodes": reachable,
        "cycleDetected": cycle_detected,
    }
    print("[INVARIANT:ll] result=" + json.dumps(result), file=sys.stderr)
    return result

def _extract_arraylist(instance):
    """Extract invariants from an ArrayList-like instance."""
    print("[INVARIANT:al] Extracting arraylist invariants from " + type(instance).__name__, file=sys.stderr)
    data = None
    data_attr_used = None
    for attr in ['_data', 'data', '_array', 'array']:
        if hasattr(instance, attr):
            data = getattr(instance, attr)
            data_attr_used = attr
            break
    stored_size = None
    size_attr_used = None
    for attr in ['_size', 'size', 'size_', 'length', '_length']:
        if hasattr(instance, attr):
            val = getattr(instance, attr)
            stored_size = val() if callable(val) else val
            size_attr_used = attr
            break
    capacity = len(data) if data is not None else None
    print("[INVARIANT:al] dataAttr=" + str(data_attr_used) + " sizeAttr=" + str(size_attr_used) + " storedSize=" + str(stored_size) + " capacity=" + str(capacity), file=sys.stderr)

    # Truncated buffer preview (first 20 elements)
    buffer_preview = None
    if data is not None:
        preview = list(data[:20])
        buffer_preview = [str(x) for x in preview]
        print("[INVARIANT:al] bufferPreview(first " + str(len(preview)) + "): " + str(buffer_preview), file=sys.stderr)

    size_in_range = (0 <= stored_size <= capacity) if stored_size is not None and capacity is not None else None
    result = {
        "type": "arraylist",
        "storedSize": stored_size,
        "capacity": capacity,
        "bufferPreview": buffer_preview,
        "sizeInRange": size_in_range,
    }
    print("[INVARIANT:al] result=" + json.dumps(result), file=sys.stderr)
    return result

def _extract_circular_queue(instance):
    """Extract invariants from a CircularQueue-like instance."""
    print("[INVARIANT:cq] Extracting circular-queue invariants from " + type(instance).__name__, file=sys.stderr)
    buffer = None
    buf_attr_used = None
    for attr in ['_buffer', '_data', 'data', '_array', 'buffer']:
        if hasattr(instance, attr):
            buffer = getattr(instance, attr)
            buf_attr_used = attr
            break
    capacity = len(buffer) if buffer is not None else None
    head_index = None
    head_attr_used = None
    for attr in ['_head', '_front', 'head', 'front']:
        if hasattr(instance, attr):
            val = getattr(instance, attr)
            if isinstance(val, int) or (callable(val) and not hasattr(val, 'next')):
                head_index = val() if callable(val) else val
                head_attr_used = attr
                break
    tail_index = None
    tail_attr_used = None
    for attr in ['_tail', '_rear', 'tail', 'rear']:
        if hasattr(instance, attr):
            val = getattr(instance, attr)
            if isinstance(val, int) or (callable(val) and not hasattr(val, 'next')):
                tail_index = val() if callable(val) else val
                tail_attr_used = attr
                break
    stored_size = None
    size_attr_used = None
    for attr in ['_size', 'size', 'size_', '_count', 'count']:
        if hasattr(instance, attr):
            val = getattr(instance, attr)
            stored_size = val() if callable(val) else val
            size_attr_used = attr
            break
    print("[INVARIANT:cq] bufAttr=" + str(buf_attr_used) + " capacity=" + str(capacity) + " headAttr=" + str(head_attr_used) + " headIdx=" + str(head_index) + " tailAttr=" + str(tail_attr_used) + " tailIdx=" + str(tail_index) + " sizeAttr=" + str(size_attr_used) + " size=" + str(stored_size), file=sys.stderr)

    buffer_preview = None
    if buffer is not None:
        preview = list(buffer[:20])
        buffer_preview = [str(x) for x in preview]
        print("[INVARIANT:cq] bufferPreview(first " + str(len(preview)) + "): " + str(buffer_preview), file=sys.stderr)

    indices_in_range = None
    if capacity is not None and capacity > 0:
        h_ok = isinstance(head_index, int) and 0 <= head_index < capacity
        t_ok = isinstance(tail_index, int) and 0 <= tail_index < capacity
        indices_in_range = h_ok and t_ok
        print("[INVARIANT:cq] headInRange=" + str(h_ok) + " tailInRange=" + str(t_ok) + " indicesInRange=" + str(indices_in_range), file=sys.stderr)

    size_in_range = (0 <= stored_size <= capacity) if stored_size is not None and capacity is not None else None
    result = {
        "type": "circular-queue",
        "headIndex": head_index,
        "tailIndex": tail_index,
        "storedSize": stored_size,
        "capacity": capacity,
        "bufferPreview": buffer_preview,
        "indicesInRange": indices_in_range,
        "sizeInRange": size_in_range,
    }
    print("[INVARIANT:cq] result=" + json.dumps(result), file=sys.stderr)
    return result

def extract_invariants(instance, class_hint=None):
    """Detect the type of data structure and extract its invariants.
    Returns a dict with a 'type' key, or None if unrecognized."""
    try:
        if instance is None:
            print("[INVARIANT:detect] instance is None, skipping", file=sys.stderr)
            return None

        cls_name = type(instance).__name__
        attrs = []
        try:
            attrs = [a for a in dir(instance) if not a.startswith('__')]
        except Exception:
            pass
        print("[INVARIANT:detect] class=" + cls_name + " hint=" + str(class_hint) + " attrs=" + str(attrs[:20]), file=sys.stderr)

        # CircularQueue: has a buffer/array + integer head/front index
        if (hasattr(instance, '_buffer') or
            (hasattr(instance, 'capacity') and (hasattr(instance, '_data') or hasattr(instance, 'data'))
             and (hasattr(instance, '_head') or hasattr(instance, '_front')))):
            print("[INVARIANT:detect] matched: circular-queue", file=sys.stderr)
            return _extract_circular_queue(instance)
        # LinkedList: has head attribute but no _data/_buffer (not an array-backed DS)
        if hasattr(instance, 'head') and not hasattr(instance, '_data') and not hasattr(instance, '_buffer'):
            head = getattr(instance, 'head', None)
            # Confirm head looks like a node (has next) or is None
            if head is None or hasattr(head, 'next'):
                print("[INVARIANT:detect] matched: linked-list", file=sys.stderr)
                return _extract_linked_list(instance)
            else:
                print("[INVARIANT:detect] has head but head has no next - not a linked list", file=sys.stderr)
        # ArrayList: has _data/_array + _size/size
        if (hasattr(instance, '_data') or hasattr(instance, 'data') or
            hasattr(instance, '_array') or hasattr(instance, 'array')):
            if (hasattr(instance, '_size') or hasattr(instance, 'size') or
                hasattr(instance, 'size_') or hasattr(instance, 'length') or
                hasattr(instance, '_length')):
                print("[INVARIANT:detect] matched: arraylist", file=sys.stderr)
                return _extract_arraylist(instance)
            else:
                print("[INVARIANT:detect] has data/array attr but no size attr - not matching arraylist", file=sys.stderr)
        print("[INVARIANT:detect] no match for " + cls_name, file=sys.stderr)
        return None
    except Exception as e:
        print("[INVARIANT:detect] ERROR: " + str(e), file=sys.stderr)
        return None

def dump_viz(locals_dict):
    """Serialize execution namespace into a typed viz payload and emit via stdout markers."""
    viz = VizSerializer()
    detected_type = "graph"  # default fallback

    for name, val in list(locals_dict.items()):
        if name.startswith('_'): continue
        if callable(val): continue

        try:
            if hasattr(val, 'next') and (hasattr(val, 'val') or hasattr(val, 'value') or hasattr(val, 'data')):
                viz.serialize_linked_list(name, val)
                detected_type = "linked-list"
            elif hasattr(val, 'left') or hasattr(val, 'right'):
                viz.serialize_tree(val)
                detected_type = "tree"
            elif hasattr(val, 'children') and (hasattr(val, 'is_end') or hasattr(val, 'isEnd')):
                viz.serialize_trie(val)
                detected_type = "tree"  # trie renders as tree
            elif isinstance(val, dict) and len(val) > 0 and any(isinstance(v, (list, set)) for v in val.values()):
                viz.serialize_graph(val)
                detected_type = "graph"
            elif isinstance(val, list) and 'heap' in name.lower():
                viz.serialize_heap(name, val)
                detected_type = "tree"  # heap renders as tree
            elif isinstance(val, (list, tuple)):
                viz.serialize_array(name, val)
                detected_type = "array"
            elif isinstance(val, dict):
                val_str = str(val)
                if len(val_str) > 50: val_str = val_str[:47] + "..."
                viz.add_node(name, f"{name}: {val_str}", "hashmap")
            elif hasattr(val, '__dict__') and not isinstance(val, type) and type(val).__name__ != 'module':
                # Custom object — inspect internal attributes for data structures
                for attr_name, attr_val in vars(val).items():
                    if attr_name.startswith('_'): continue
                    full_name = f"{name}.{attr_name}"
                    if hasattr(attr_val, 'next') and (hasattr(attr_val, 'val') or hasattr(attr_val, 'value') or hasattr(attr_val, 'data')):
                        viz.serialize_linked_list(full_name, attr_val)
                        detected_type = "linked-list"
                    elif hasattr(attr_val, 'left') or hasattr(attr_val, 'right'):
                        viz.serialize_tree(attr_val)
                        detected_type = "tree"
                    elif isinstance(attr_val, (list, tuple)):
                        viz.serialize_array(full_name, attr_val)
                        detected_type = "array"
                    elif isinstance(attr_val, dict) and len(attr_val) > 0:
                        val_str = str(attr_val)
                        if len(val_str) > 50: val_str = val_str[:47] + "..."
                        viz.add_node(full_name, f"{full_name}: {val_str}", "hashmap")
        except Exception:
            continue  # Skip variables that cause errors during serialization

    # Extract invariants and structures from tested instance (if available)
    _state_snapshot = None
    instance_detected_type = None
    _inst = locals_dict.get('_last_tested_instance')
    if _inst is not None:
        try:
            _state_snapshot = extract_invariants(_inst)
        except Exception:
            pass
        # If _inst is not a recognized data structure (e.g. it's a TestCase class),
        # search its public attributes for the actual data structure being tested.
        # Common pattern: test setUp creates self.ll = MyLinkedList(), self.ht = HashTable(), etc.
        if _state_snapshot is None:
            try:
                for attr_name in dir(_inst):
                    if attr_name.startswith('_'): continue
                    if callable(getattr(type(_inst), attr_name, None)): continue
                    attr_val = getattr(_inst, attr_name, None)
                    if attr_val is None: continue
                    if isinstance(attr_val, (int, float, str, bool, bytes)): continue
                    try:
                        _candidate_snap = extract_invariants(attr_val)
                        if _candidate_snap is not None:
                            _inst = attr_val
                            _state_snapshot = _candidate_snap
                            break
                    except Exception:
                        continue
            except Exception:
                pass
        # Seed instance_detected_type from invariant extraction (handles edge cases
        # like empty linked-list where head=None so attribute-level checks fail)
        if _state_snapshot is not None and instance_detected_type is None:
            _snap_type = _state_snapshot.get("type")
            if _snap_type == "linked-list":
                instance_detected_type = "linked-list"
            elif _snap_type == "arraylist":
                instance_detected_type = "array"
            elif _snap_type == "circular-queue":
                instance_detected_type = "array"
        # Serialize the actual data structure instance's attributes as viz nodes
        # (skip _-prefixed private attrs to avoid internal Python/unittest attributes)
        try:
            for attr_name, attr_val in vars(_inst).items():
                if attr_name.startswith('_'): continue
                full_name = f"instance.{attr_name}"
                if hasattr(attr_val, 'next') and (hasattr(attr_val, 'val') or hasattr(attr_val, 'value') or hasattr(attr_val, 'data')):
                    viz.serialize_linked_list(full_name, attr_val)
                    detected_type = "linked-list"
                    if instance_detected_type is None:
                        instance_detected_type = "linked-list"
                elif hasattr(attr_val, 'left') or hasattr(attr_val, 'right'):
                    viz.serialize_tree(attr_val)
                    detected_type = "tree"
                    if instance_detected_type is None:
                        instance_detected_type = "tree"
                elif hasattr(attr_val, 'children') and (hasattr(attr_val, 'is_end') or hasattr(attr_val, 'isEnd')):
                    viz.serialize_trie(attr_val)
                    detected_type = "tree"
                    if instance_detected_type is None:
                        instance_detected_type = "tree"
                elif isinstance(attr_val, dict) and len(attr_val) > 0 and any(isinstance(v, (list, set)) for v in attr_val.values()):
                    viz.serialize_graph(attr_val)
                    detected_type = "graph"
                    if instance_detected_type is None:
                        instance_detected_type = "graph"
                elif isinstance(attr_val, list) and 'heap' in attr_name.lower():
                    viz.serialize_heap(full_name, attr_val)
                    detected_type = "tree"
                    if instance_detected_type is None:
                        instance_detected_type = "tree"
                elif isinstance(attr_val, (list, tuple)):
                    viz.serialize_array(full_name, attr_val)
                    detected_type = "array"
                    if instance_detected_type is None:
                        instance_detected_type = "array"
                elif isinstance(attr_val, dict) and len(attr_val) > 0:
                    val_str = str(attr_val)
                    if len(val_str) > 50: val_str = val_str[:47] + "..."
                    viz.add_node(full_name, f"{full_name}: {val_str}", "hashmap")
        except Exception:
            pass  # Non-fatal: instance attribute serialization failed
        # RCA: LinkedList often stores head as _head; we skip _-prefixed attrs above,
        # so no nodes get serialized. When we already know it's a linked-list (from
        # stateSnapshot), explicitly serialize from head (public or _head).
        if _state_snapshot is not None and _state_snapshot.get("type") == "linked-list":
            _head = getattr(_inst, "head", None) or getattr(_inst, "_head", None)
            if _head is not None and (hasattr(_head, "next") and (hasattr(_head, "val") or hasattr(_head, "value") or hasattr(_head, "data"))):
                if not any(n.get("type") == "ll_node" for n in viz.nodes):
                    viz.serialize_linked_list("instance.head", _head)

    if viz.nodes or _state_snapshot:
        try:
            final_type = instance_detected_type if instance_detected_type is not None else detected_type
            # When final_type was seeded from stateSnapshot (e.g. linked-list with head=None),
            # but viz.nodes only has non-matching nodes (e.g. array nodes from test locals),
            # emit an empty structure so the renderer shows "Empty list" instead of garbage.
            _has_matching_nodes = True
            if final_type == "linked-list" and viz.nodes:
                _has_matching_nodes = any(n.get("type") == "ll_node" for n in viz.nodes)
            _structure = {}
            if viz.nodes and _has_matching_nodes:
                _structure = viz.to_typed_structure(final_type)
            elif final_type == "linked-list":
                _structure = {"nodes": [], "nextPointers": []}
            elif viz.nodes:
                _structure = viz.to_typed_structure(final_type)
            payload = {
                "diagramType": final_type,
                "structure": _structure,
                "markers": viz.get_markers(locals_dict),
                "truncated": len(viz.nodes) >= viz.max_nodes
            }
            if _state_snapshot:
                payload["stateSnapshot"] = _state_snapshot
            print("")
            print("=== VIZ_PAYLOAD_START ===")
            print(json.dumps(payload))
            print("=== VIZ_PAYLOAD_END ===")
            print("")
        except Exception:
            pass  # Never crash on viz serialization failure

def check_package_policy(code_str):
    lines = code_str.split('\\\\n')
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#') or stripped.startswith('"""') or stripped.startswith("'''"):
            continue
        import_match = re.match(r'^\\\\s*(?:from\\\\s+([a-zA-Z0-9_\\\\.]+)\\\\s+import|import\\\\s+([a-zA-Z0-9_\\\\.]+))', line)
        if import_match:
            module_name = import_match.group(1) or import_match.group(2)
            root_module = module_name.split('.')[0]
            allowed_modules = {
                'os', 'sys', 'json', 'math', 'random', 'time', 'datetime', 'collections',
                'itertools', 'functools', 'operator', 'string', 're', 'io', 'pathlib',
                'typing', 'dataclasses', 'enum', 'abc', 'copy', 'pickle', 'base64',
                'hashlib', 'uuid', 'urllib', 'http', 'socket', 'threading', 'multiprocessing',
                'subprocess', 'shutil', 'glob', 'fnmatch', 'tempfile', 'zipfile',
                'csv', 'xml', 'html', 'email', 'logging', 'warnings', 'traceback',
                'inspect', 'ast', 'dis', 'gc', 'weakref', 'contextlib', 'fractions',
                'decimal', 'statistics', 'array', 'struct', 'mmap', 'codecs',
                'unicodedata', 'locale', 'gettext', 'argparse', 'configparser',
                'fileinput', 'linecache', 'cmd', 'shlex', 'readline', 'rlcompleter',
                'pdb', 'profile', 'pstats', 'timeit', 'trace', 'faulthandler',
                'signal', 'atexit', 'sysconfig', 'platform', 'ctypes', 'cffi',
                'heapq', '_heapq', 'deque',
                'arraylist', 'trie', 'graph', 'heap', 'min_heap', 'hashtable', 'linkedlist',
                'bisect', 'queue', 'numbers', 'types', 'typing_extensions',
                'unittest', '_unittest', 'graphs', 'warmup', 'solution'
            }
            if root_module not in allowed_modules:
                raise ImportError(f"Package policy violation: '{root_module}' not allowed")

def run_tests_implementation(code_str, test_cases_json, user_namespace):
    test_cases = json.loads(test_cases_json)
    results = []
    for test in test_cases:
        test_id = test.get('id', '')
        fn_name = test.get('fn', 'solve')
        class_name = test.get('className')
        args = test.get('args', [])
        expected = test.get('expected')
        start_time = time.time()
        result = { 'id': test_id, 'fn': fn_name, 'passed': False, 'durationMs': 0 }
        try:
            if 'fn' not in test:
                result['error'] = "Test metadata missing fn"
            elif fn_name == "__design__" and isinstance(args, list) and len(args) >= 2:
                operations, arguments = args[0], args[1]
                class_for_design = operations[0]
                if class_for_design not in user_namespace:
                    result['error'] = f"Class {class_for_design} not found"
                else:
                    cls = user_namespace[class_for_design]
                    ctor_args = list(arguments[0]) if arguments else []
                    instance = cls(*ctor_args)
                    received_list = [None]
                    for i in range(1, len(operations)):
                        method_name = operations[i]
                        method_args = list(arguments[i]) if i < len(arguments) else []
                        if not hasattr(instance, method_name):
                            result['error'] = f"Method {method_name} missing"
                            break
                        method = getattr(instance, method_name)
                        received_list.append(method(*method_args))
                    else:
                        result['expected'] = expected
                        result['received'] = received_list
                        result['passed'] = received_list == expected
                    # Expose instance for invariant extraction
                    user_namespace['_last_tested_instance'] = instance
                    print("[INVARIANT:run_tests] __design__ path: exposed _last_tested_instance type=" + type(instance).__name__, file=sys.stderr)
            elif class_name:
                if class_name not in user_namespace:
                    result['error'] = f"Class {class_name} not found"
                else:
                    cls = user_namespace[class_name]
                    instance = cls()
                    if not hasattr(instance, fn_name):
                         result['error'] = f"Method {fn_name} missing"
                    else:
                         method = getattr(instance, fn_name)
                         received = method(*args) if args else method()
                         if expected is not None:
                             result['expected'] = expected
                             result['received'] = received
                             result['passed'] = received == expected
                         else:
                             result['passed'] = True
                             result['received'] = received
                    # Expose instance for invariant extraction
                    user_namespace['_last_tested_instance'] = instance
                    print("[INVARIANT:run_tests] className path: exposed _last_tested_instance type=" + type(instance).__name__, file=sys.stderr)
            elif fn_name not in user_namespace:
                 result['error'] = f"Function {fn_name} not found"
            else:
                 fn = user_namespace[fn_name]
                 received = fn(*args) if args else fn()
                 if expected is not None:
                      result['expected'] = expected
                      result['received'] = received
                      result['passed'] = received == expected
                 else:
                      result['passed'] = True
                      result['received'] = received
        except Exception as e:
            result['error'] = str(e)
            result['passed'] = False
        finally:
            result['durationMs'] = (time.time() - start_time) * 1000
            results.append(result)
    return results
`;

// ========================================================
// SECTION 3: PYODIDE INITIALIZATION
// ========================================================
const PYODIDE_INIT = `
let pyodide = null;
let interruptBuffer = null;

async function initPyodide(indexURL) {
  console.log('[WORKER] Initializing Pyodide...');
  let baseUrl = indexURL || '/pyodide/0.28.2/';
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  const absoluteBase = baseUrl.startsWith('http') ? baseUrl : self.location.origin + baseUrl;

  console.log('[WORKER] Fetching pyodide.js from:', absoluteBase);
  const response = await fetch(absoluteBase + 'pyodide.js');
  (0, eval)(await response.text());

  console.log('[WORKER] Loading Pyodide runtime...');
  pyodide = await self.loadPyodide({ indexURL: absoluteBase });

  if (typeof SharedArrayBuffer !== 'undefined') {
    console.log('[WORKER] Setting up interrupt buffer...');
    interruptBuffer = new SharedArrayBuffer(4);
    pyodide.setInterruptBuffer(interruptBuffer);
  }

  console.log('[WORKER] Loading Python modules...');
  await pyodide.runPythonAsync(\`${PYTHON_MODULES}\`);
  console.log('[WORKER] Python modules loaded successfully');
}
`;

// ========================================================
// SECTION 4: EXECUTION CONTROLLER
// ========================================================
const EXECUTION_CONTROLLER = `
async function runCode(code, testCases, timeoutMs = 2000, memLimitMB = 128) {
  console.log('[WORKER] runCode called with timeout:', timeoutMs, 'ms, memLimit:', memLimitMB, 'MB');
  if (!pyodide) throw new Error('Pyodide not initialized');

  const startTime = Date.now();
  let timedOut = false;
  let memExceeded = false;

  let timeoutId = null;
  if (interruptBuffer) {
    new Uint8Array(interruptBuffer)[0] = 0;
    timeoutId = self.setTimeout(() => {
      console.warn('[WORKER] Execution timeout triggered');
      new Uint8Array(interruptBuffer)[0] = 2;
      timedOut = true;
    }, timeoutMs);
  }

  const memCheckInterval = self.setInterval(() => {
    try {
      if (pyodide.pyodide_py._module.HEAPU8.buffer.byteLength > memLimitMB * 1024 * 1024) {
        console.warn('[WORKER] Memory limit exceeded');
        memExceeded = true;
        if (interruptBuffer) new Uint8Array(interruptBuffer)[0] = 2;
      }
    } catch(e){}
  }, 50);

  let stdout = '', stderr = '', exitCode = EXIT_OK, testSummary;
  let processedUserTests = null;

  try {
    const hasTests = testCases && testCases.length > 0;
    console.log('[WORKER] Has tests:', hasTests, '| Test count:', testCases?.length || 0);
    console.log('[WORKER] Executing Python code...');

    const result = await pyodide.runPythonAsync(\`
with OutputCapture() as capture:
    _exec_ns = {'__name__': '__pyodide_exec__', '__file__': '/workspace/solution.py', '_dump_viz': dump_viz}
    _test_results = []
    _user_tests_results = []
    try:
        check_package_policy(\${JSON.stringify(code)})
        exec(\${JSON.stringify(code)}, _exec_ns)
        \${hasTests ? \`_test_results = run_tests_implementation(\${JSON.stringify(code)}, \${JSON.stringify(JSON.stringify(testCases))}, _exec_ns)\` : ''}
        if 'USER_TESTS' in _exec_ns and isinstance(_exec_ns['USER_TESTS'], list):
            for t_fn in _exec_ns['USER_TESTS']:
                if callable(t_fn):
                    t_name = getattr(t_fn, '__name__', 'unknown')
                    try:
                        t_fn()
                        _user_tests_results.append({'name': t_name, 'status': 'pass'})
                    except AssertionError as e:
                        _user_tests_results.append({'name': t_name, 'status': 'fail', 'error': str(e)})
                        dump_viz(_exec_ns)
                    except Exception as e:
                        _user_tests_results.append({'name': t_name, 'status': 'error', 'error': str(e)})
                        dump_viz(_exec_ns)
        if _test_results and any(not r['passed'] for r in _test_results):
            # Only emit backup viz if test runner didn't already emit one
            if '=== VIZ_PAYLOAD_START ===' not in capture.stdout.getvalue():
                # Filter out test runner infrastructure and stdlib modules
                _viz_ns = {k: v for k, v in _exec_ns.items()
                           if k not in ('test_results', 'test_output', '_failing_test_locals',
                                        'run_test', '__run_unittest__', '_dump_viz',
                                        'sys', 'io', 'json', 'time', 'traceback', 're',
                                        'collections', 'unittest', 'os', 'math')}
                dump_viz(_viz_ns)
    except SystemExit:
        pass
    except Exception as _exc:
        traceback.print_exc()
        if '=== VIZ_PAYLOAD_START ===' not in capture.stdout.getvalue():
            try:
                dump_viz(_exec_ns)
            except Exception:
                pass
    finally:
        _out, _err = capture.get_output()
(_out, _err, _test_results, _user_tests_results)
    \`);

    console.log('[WORKER] Python execution completed successfully');
    stdout = result[0] || '';
    stderr = result[1] || '';
    const testResultsRaw = result[2];
    const userTestsRaw = result[3];

    console.log('[WORKER] stdout length:', stdout?.length || 0, '| stderr length:', stderr?.length || 0);

    if (testResultsRaw) {
       const cases = testResultsRaw.toJs({dict_converter: Object.fromEntries});
       testSummary = {
           total: cases.length,
           passed: cases.filter(c => c.passed).length,
           failed: cases.filter(c => !c.passed).length,
           cases: cases
       };
       console.log('[WORKER] Test summary:', testSummary.passed, '/', testSummary.total, 'passed');
    }

    if (userTestsRaw && userTestsRaw.length) {
        processedUserTests = userTestsRaw.toJs({dict_converter: Object.fromEntries});
        console.log('[WORKER] User tests count:', processedUserTests.length);
    }

    if (timedOut) { exitCode = EXIT_TIMEOUT; stderr += '\\nExecution timed out'; }
    else if (memExceeded) { exitCode = EXIT_MEMORY; stderr += '\\nMemory limit exceeded'; }
    else if (stderr.includes('Package policy violation')) { exitCode = EXIT_ERROR; }
    else if (stderr.includes('Traceback')) { exitCode = EXIT_ERROR; }
    else if (testSummary && testSummary.failed > 0) { exitCode = EXIT_ERROR; }

    console.log('[WORKER] Exit code:', exitCode);

  } catch (e) {
    console.error('[WORKER] Python execution error:', e);
    console.error('[WORKER] Error type:', e?.constructor?.name);
    console.error('[WORKER] Error message:', e?.message);
    stderr = String(e);
    exitCode = EXIT_ERROR;
  } finally {
    self.clearInterval(memCheckInterval);
    if (timeoutId) self.clearTimeout(timeoutId);
  }

  // ================================================================
  // POST-EXECUTION: Viz extraction, truncation, reason classification
  // ================================================================

  // ---- Extract viz payloads from stdout ----
  // Scan for VIZ_PAYLOAD markers, extract JSON, remove from stdout.
  // If multiple payloads found, use the LAST one (last known state).
  let viz = null;
  try {
    let cleanStdout = stdout;
    let lastVizPayload = null;

    // Find ALL viz payload blocks and extract the last one
    let searchFrom = 0;
    while (true) {
      const startIdx = cleanStdout.indexOf(VIZ_START_MARKER, searchFrom);
      if (startIdx === -1) break;
      const endIdx = cleanStdout.indexOf(VIZ_END_MARKER, startIdx);
      if (endIdx === -1) break;

      const jsonStr = cleanStdout.substring(startIdx + VIZ_START_MARKER.length, endIdx).trim();
      try {
        lastVizPayload = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.warn('[WORKER] Malformed viz JSON, skipping:', parseErr);
      }
      searchFrom = endIdx + VIZ_END_MARKER.length;
    }

    // Remove ALL viz payload blocks (including surrounding blank lines) from stdout
    // Pattern: optional newline, marker start, content, marker end, optional newline
    let stripped = stdout;
    while (true) {
      const sIdx = stripped.indexOf(VIZ_START_MARKER);
      if (sIdx === -1) break;
      const eIdx = stripped.indexOf(VIZ_END_MARKER, sIdx);
      if (eIdx === -1) break;

      // Find the start of the block (consume preceding newline if present)
      let blockStart = sIdx;
      if (blockStart > 0 && stripped[blockStart - 1] === '\\n') blockStart--;

      // Find the end of the block (consume trailing newline if present)
      let blockEnd = eIdx + VIZ_END_MARKER.length;
      if (blockEnd < stripped.length && stripped[blockEnd] === '\\n') blockEnd++;

      stripped = stripped.substring(0, blockStart) + stripped.substring(blockEnd);
    }
    stdout = stripped;

    if (lastVizPayload) {
      // Validate basic shape: must have diagramType and (structure or stateSnapshot)
      if (lastVizPayload.diagramType && (lastVizPayload.structure || lastVizPayload.stateSnapshot)) {
        viz = {
          diagramType: lastVizPayload.diagramType,
          structure: lastVizPayload.structure || {},
          markers: lastVizPayload.markers || {},
          truncated: !!lastVizPayload.truncated
        };
        if (lastVizPayload.stateSnapshot) {
          viz.stateSnapshot = lastVizPayload.stateSnapshot;
        }
      } else if (lastVizPayload.nodes) {
        // Legacy format fallback: {nodes, edges} without diagramType
        viz = {
          diagramType: "graph",
          structure: { nodes: lastVizPayload.nodes, edges: lastVizPayload.edges || [] },
          markers: {},
          truncated: false
        };
      }
    }
  } catch (vizErr) {
    console.warn('[WORKER] Viz extraction error (non-fatal):', vizErr);
    viz = null;
  }

  // ---- Enforce stdout/stderr size limits ----
  let stdoutTruncated = false;
  let stderrTruncated = false;

  if (stdout.length > MAX_STDOUT) {
    const totalLen = stdout.length;
    stdout = stdout.substring(0, MAX_STDOUT) + '\\n... [truncated: ' + totalLen + ' total chars]';
    stdoutTruncated = true;
  }

  if (stderr.length > MAX_STDERR) {
    const totalLen = stderr.length;
    stderr = stderr.substring(0, MAX_STDERR) + '\\n... [truncated: ' + totalLen + ' total chars]';
    stderrTruncated = true;
  }

  // ---- Classify failure reason ----
  let reason = null;
  if (exitCode === EXIT_OK) {
    reason = 'SUCCESS';
  } else if (exitCode === EXIT_TIMEOUT || timedOut) {
    reason = 'TIMEOUT';
  } else if (exitCode === EXIT_MEMORY || memExceeded) {
    reason = 'MEMORY';
  } else if (stderr.includes('Package policy violation') || stderr.includes('ImportError') || stderr.includes('ModuleNotFoundError')) {
    reason = 'IMPORT_FAIL';
  } else if (testSummary && testSummary.failed > 0 && !stderr.includes('Traceback')) {
    reason = 'TEST_FAILURE';
  } else if (stderr.includes('Traceback') || stderr.includes('Error') || stderr.includes('Exception')) {
    reason = 'RUNTIME_ERROR';
  }
  
  // ---- Error Handling Refinement (SyntaxError / Traceback Cleanup) ----
  if (stderr.includes('SyntaxError') || stderr.includes('IndentationError')) {
      reason = 'COMPILATION_ERROR';
      exitCode = EXIT_ERROR; // Ensure exit code reflects error
      
      // Clean up traceback: remove internal Pyodide frames
      // Keep only lines that don't start with '  File "/lib/' or '  File "<exec>"' (unless followed by user code context)
      // Actually, standard Python tracebacks have:
      //   File "filename", line X, in module
      //     code_line
      // We want to hide /lib/python3.13... frames.
      
      try {
          const lines = stderr.split('\\n');
          const cleanLines = [];
          
          // Heuristic:
          // 1. Keep "Traceback (most recent call last):"
          // 2. Filter out frames starting with '  File "/lib/'
          // 3. Keep frames related to user code (often <exec> or solution.py)
          // 4. Always keep the final error message (last line usually)
          
          let skipNext = false;
          for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              
              // Internal Pyodide/Python lib frames
              if (line.trim().startsWith('File "/lib/python')) {
                 skipNext = true; // Skip this file line
                 continue; 
              }
              
              // If we skipped the file line, also skip the code context line(s) associated with it
              // Python usually gives:
              //   File "...", line ...
              //     code
              //     ^
              if (skipNext) {
                  // If line starts with '  File', it's a NEW frame, stop skipping (unless it's also /lib)
                  if (line.trim().startsWith('File "')) {
                      if (line.trim().startsWith('File "/lib/python')) {
                          skipNext = true;
                      } else {
                          skipNext = false;
                          cleanLines.push(line);
                      }
                  } else {
                     // It's the code context or caret, skip it
                     continue;
                  }
              } else {
                  cleanLines.push(line);
              }
          }
          
          // If we filtered too much and lost the error message, fallback to original
          if (cleanLines.length < 1) {
             // do nothing, keep stderr
          } else {
             stderr = cleanLines.join('\\n').trim();
          }
      } catch (cleanErr) {
          // Fallback: don't touch stderr if regex fails
          console.warn('[WORKER] Traceback cleanup failed', cleanErr);
      }
  }
  // If none matched, reason stays null (unknown/unclassified)

  // ---- Normalize user test results ----
  let normalizedUserTests = null;
  if (processedUserTests && Array.isArray(processedUserTests) && processedUserTests.length > 0) {
    normalizedUserTests = processedUserTests.map(function(t) {
      return {
        name: t.name || 'unknown',
        status: t.status || 'error',
        error: t.error || undefined
      };
    });
  }

  return {
      stdout, stderr, exitCode, testSummary, viz, reason,
      durationMs: Date.now() - startTime,
      meta: {
        timedOut, memExceeded,
        stdoutTruncated, stderrTruncated,
        userTests: normalizedUserTests
      }
  };
}
`;

// ========================================================
// SECTION 5: MESSAGE ROUTER
// ========================================================
const MESSAGE_ROUTER = `
self.addEventListener('message', async (e) => {
  const { cmd, reqId } = e.data;
  console.log('[WORKER] Received command:', cmd, '| reqId:', reqId);

  if (cmd === 'INIT') {
    try {
        console.log('[WORKER] Starting INIT sequence...');
        await initPyodide(e.data.indexURL);
        console.log('[WORKER] INIT complete, sending READY');
        self.postMessage({ cmd: 'READY', reqId });
    } catch(err) {
        console.error('[WORKER] INIT failed:', err);
        self.postMessage({ cmd: 'ERROR', reqId, error: String(err) });
    }
  } else if (cmd === 'RUN') {
    console.log('[WORKER] Starting RUN command...');
    const res = await runCode(e.data.code, e.data.testCases, e.data.timeoutMs, e.data.memLimitMB);
    console.log('[WORKER] RUN complete, sending RESULT');
    self.postMessage({ cmd: 'RESULT', reqId, data: res });
  } else if (cmd === 'PING') {
    console.log('[WORKER] Responding to PING');
    self.postMessage({ cmd: 'ACK', reqId, nonce: e.data.nonce });
  }
});

console.log('[WORKER] Message handler registered, worker ready');
`;

// ========================================================
// FINAL EXPORT: Join all sections into a single string
// ========================================================
export const pyodideWorkerCode = [
    WORKER_SETUP,
    PYODIDE_INIT,
    EXECUTION_CONTROLLER,
    MESSAGE_ROUTER
].join('\n');
