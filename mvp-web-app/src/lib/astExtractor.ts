/**
 * astExtractor.ts
 *
 * Utility to extract a simplified AST structure from Python code using
 * the existing Pyodide shadow runner infrastructure.
 *
 * Produces a minimal representation (FunctionDefs, ClassDefs, If/While/For
 * nodes with line numbers) to keep Gemini context tokens low.
 */

/**
 * A simplified AST node for Gemini consumption.
 */
export interface SimpleASTNode {
  type: string;     // e.g. "FunctionDef", "If", "While", "For", "ClassDef"
  name?: string;    // function/class name if applicable
  lineno: number;   // 1-based line number
  children?: SimpleASTNode[];
}

/**
 * Build the Pyodide script that parses code and returns a simplified AST.
 * The script is self-contained — it base64-decodes the user code to avoid
 * quoting issues, parses with ast.parse, then walks the tree extracting
 * only the structural nodes we care about.
 */
function buildExtractionScript(base64Code: string): string {
  // No leading indentation — Pyodide executes this as top-level Python.
  return `
import ast
import base64
import json

_INTERESTING = {
    "FunctionDef", "AsyncFunctionDef", "ClassDef",
    "If", "While", "For",
    "Try", "ExceptHandler",
    "Return", "Assign",
}

def _simplify(node):
    """Recursively extract interesting AST nodes."""
    results = []
    for child in ast.iter_child_nodes(node):
        kind = type(child).__name__
        if kind in _INTERESTING:
            entry = {"type": kind, "lineno": getattr(child, "lineno", 0)}
            name = getattr(child, "name", None)
            if name:
                entry["name"] = name
            sub = _simplify(child)
            if sub:
                entry["children"] = sub
            results.append(entry)
        else:
            results.extend(_simplify(child))
    return results

try:
    _code = base64.b64decode("${base64Code}").decode("utf-8")
    _tree = ast.parse(_code)
    _simplified = _simplify(_tree)
    result = {"ok": True, "ast": _simplified}
except SyntaxError as e:
    result = {"ok": False, "error": f"SyntaxError: {e.msg} (line {e.lineno})"}
except Exception as e:
    result = {"ok": False, "error": str(e)}

result
`;
}

/**
 * Extract a simplified AST from Python code using the shadow runner.
 *
 * @param code     - The Python source code to parse.
 * @param runFn    - The `run` function from useShadowRunner (or equivalent).
 * @returns        - JSON string of the simplified AST, or an error string.
 */
export async function extractAST(
  code: string,
  runFn: (code: string, inputs?: unknown[]) => Promise<{ success: boolean; output: unknown; error?: string }>
): Promise<string> {
  // [verification-agent] Step 3a: extractAST — input
  console.log("[verification-agent] Step 3a: extractAST — input", { codeLength: code?.length ?? 0 });

  if (!code || code.trim().length === 0) {
    const empty = JSON.stringify({ ok: true, ast: [] });
    console.log("[verification-agent] Step 3b: extractAST — output (empty)", { outputLength: empty.length });
    return empty;
  }

  // Base64-encode to avoid quoting/escaping issues
  const base64Code =
    typeof btoa !== "undefined"
      ? btoa(unescape(encodeURIComponent(code)))
      : Buffer.from(code, "utf-8").toString("base64");

  const script = buildExtractionScript(base64Code);
  const result = await runFn(script, []);

  if (result.success && result.output && typeof result.output === "object") {
    const out = result.output as Record<string, unknown>;
    if (out.ok) {
      const astStr = JSON.stringify(out.ast, null, 2);
      console.log("[verification-agent] Step 3b: extractAST — output", { outputLength: astStr.length });
      return astStr;
    }
    console.log("[verification-agent] Step 3b: extractAST — error", { error: out.error });
    return `AST extraction error: ${out.error}`;
  }

  console.log("[verification-agent] Step 3b: extractAST — shadow runner error", { error: result.error });
  return `Shadow runner error: ${result.error ?? "unknown"}`;
}
