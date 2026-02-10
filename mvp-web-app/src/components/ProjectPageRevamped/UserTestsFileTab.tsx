"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ProjectData } from "../CodeEditor/types";
import { Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import CodeEditor from "../CodeEditor/CodeEditor";
import { logCodeAction } from "@/lib/actionLogger";

interface UserTestsFileTabProps {
  projectData: ProjectData | null;
  files: Record<string, string>;
  userTestsCode: string;
  onUserTestsCodeChange: (code: string) => void;
  autoSaveKey: string | null;
}

// Default template for user tests (exported for boss fight append logic)
export const DEFAULT_USER_TESTS_TEMPLATE = `# ==========================================
# 🧪 STUDENT TESTING SANDBOX
# ==========================================
# Use this file to "stress test" your code before submitting.
#
# HOW TO USE:
# 1. Import your class (e.g., from arraylist import ArrayList)
# 2. Uncomment the example test function for your current project.
# 3. Add the function name to the 'USER_TESTS' list at the bottom.
# ==========================================

# --- 1. GENERIC TEST EXAMPLE (Start Here) ---
def test_generic_logic():
    """
    A simple example showing the 'Arrange, Act, Assert' pattern.
    """
    print("--- Running Generic Test ---")
    
    # 1. ARRANGE: Set up the variables
    expected_value = 10
    actual_value = 5 + 5
    
    # 2. ACT & ASSERT: Check if they match
    # Format: assert <condition>, <error_message>
    assert actual_value == expected_value, f"Math failed! Got {actual_value}"
    
    print("✅ Generic Test Passed!")


# --- 2. PROJECT-SPECIFIC EXAMPLES (Uncomment the one you need) ---

# 🔹 PROJECT 1: ARRAYLIST
# from arraylist import ArrayList
# def test_arraylist():
#     print("--- Testing ArrayList ---")
#     arr = ArrayList()
#     arr.add("A")
#     arr.add("B")
#     arr.add("C")
#     
#     assert arr.get(0) == "A", "Index 0 should be 'A'"
#     assert arr.size() == 3, "Size should be 3 after additions"
#     print("✅ ArrayList Passed!")

# 🔹 PROJECT 2: LINKED LIST
# from linked_list import LinkedList
# def test_linked_list():
#     print("--- Testing Linked List ---")
#     ll = LinkedList()
#     ll.append("Node1")
#     ll.append("Node2")
#     
#     # Assuming standard head/next structure
#     assert ll.head.value == "Node1", "Head should be Node1"
#     assert ll.head.next.value == "Node2", "Second node should be Node2"
#     print("✅ Linked List Passed!")

# 🔹 PROJECT 3: HASHTABLE
# from hashtable import Hashtable
# def test_hashtable():
#     print("--- Testing Hashtable ---")
#     ht = Hashtable()
#     ht.put("key", "value")
#     ht.put("key", "updated")  # Collision/Update check
#     
#     assert ht.get("key") == "updated", "Value should update on duplicate key"
#     assert ht.get("missing") is None, "Missing key should return None"
#     print("✅ Hashtable Passed!")

# 🔹 PROJECT 4: HEAP (Binary Heap)
# from heap import MinHeap  # Check your actual class name
# def test_heap():
#     print("--- Testing Heap ---")
#     h = MinHeap()
#     h.push(10)
#     h.push(5)
#     h.push(20)
#     
#     # In a MinHeap, pop() should return the smallest element (5)
#     assert h.pop() == 5, "Heap did not pop the smallest element first"
#     assert h.peek() == 10, "Next smallest should be at the top"
#     print("✅ Heap Passed!")

# 🔹 PROJECT 5: GRAPH
# from graph import Graph
# def test_graph():
#     print("--- Testing Graph ---")
#     g = Graph()
#     g.add_vertex("A")
#     g.add_vertex("B")
#     g.add_edge("A", "B")
#     
#     neighbors = g.get_neighbors("A")
#     assert "B" in neighbors, "Vertex B should be connected to A"
#     print("✅ Graph Passed!")

# 🔹 PROJECT 6: TRIE (Prefix Tree)
# from trie import Trie
# def test_trie():
#     print("--- Testing Trie ---")
#     t = Trie()
#     t.insert("apple")
#     t.insert("app")
#     
#     assert t.search("apple") is True, "Should find exact word 'apple'"
#     assert t.search("app") is True, "Should find prefix word 'app'"
#     assert t.search("ap") is False, "Should not find incomplete word 'ap' if not inserted"
#     print("✅ Trie Passed!")


# ==========================================
# 🚀 REGISTER YOUR TESTS HERE
# ==========================================
# Add your test function names to this list so the system runs them.
USER_TESTS = [
    test_generic_logic,
    # test_arraylist,
    # test_linked_list,
    # test_hashtable,
    # test_heap,
    # test_graph,
    # test_trie
]
`;

/**
 * User Tests File Tab - Code editor for writing Python test functions
 * Displayed when the "My Tests" tab is active
 */
export const UserTestsFileTab: React.FC<UserTestsFileTabProps> = ({
  projectData,
  files,
  userTestsCode,
  onUserTestsCodeChange,
  autoSaveKey,
}) => {
  const [codeValue, setCodeValue] = useState(userTestsCode || DEFAULT_USER_TESTS_TEMPLATE);

  // Sync with parent when code changes
  // Use DEFAULT_USER_TESTS_TEMPLATE if userTestsCode is empty to ensure starter code always renders
  useEffect(() => {
    const codeToUse = userTestsCode || DEFAULT_USER_TESTS_TEMPLATE;
    if (userTestsCode !== undefined && codeToUse !== codeValue) {
      setCodeValue(codeToUse);
    }
  }, [userTestsCode, codeValue]);

  const handleCodeChange = (newCode: string | undefined) => {
    const code = newCode || "";
    setCodeValue(code);
    onUserTestsCodeChange(code);
  };

  const handleResetToTemplate = () => {
    if (confirm("Reset to default template? This will delete your current tests.")) {
      setCodeValue(DEFAULT_USER_TESTS_TEMPLATE);
      onUserTestsCodeChange(DEFAULT_USER_TESTS_TEMPLATE);
      toast.success("Reset to default template");
      // Log code reset action
      logCodeAction("code_reset", "user_tests", { projectId: projectData?.id });
    }
  };

  const hasUserTests = codeValue.includes("USER_TESTS");

  return (
    <div className="h-full flex flex-col bg-[#181818] overflow-hidden">
      {/* Header */}
      <div className="flex-none px-4 py-3 border-b border-[#262626] bg-[#19191c] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            User Tests
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Write Python tests to validate your solution (does not affect grading)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToTemplate}
            className="text-gray-400 border-gray-600/30 hover:bg-gray-700/50 text-xs h-8"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset Template
          </Button>
          {!hasUserTests && (
            <div className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/30">
              ⚠ Define USER_TESTS list to run tests
            </div>
          )}
        </div>
      </div>

      {/* Code Editor */}
      <div className="flex-1 overflow-hidden">
        <CodeEditor
          value={codeValue}
          onChange={handleCodeChange}
          language="python"
          readOnly={false}
          autoSaveKey={autoSaveKey || undefined}
        />
      </div>

      {/* Instructions Footer */}
      <div className="flex-none px-4 py-2 border-t border-[#262626] bg-[#19191c] text-xs text-gray-400">
      </div>
    </div>
  );
};
