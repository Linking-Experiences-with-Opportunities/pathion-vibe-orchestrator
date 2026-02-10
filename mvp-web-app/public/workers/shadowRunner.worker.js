/**
 * Shadow Runner Worker
 * 
 * A lightweight Web Worker that runs Python code using Pyodide.
 * Designed for quick code execution with simple input/output.
 * 
 * Messages:
 *   IN:  { code: string, inputs: any[] }
 *   OUT: { success: boolean, output: any, error?: string }
 */

// Polyfill for Object.hasOwn (ES2022) - required for older Safari versions
if (!Object.hasOwn) {
  Object.hasOwn = function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

const PYODIDE_BASE_URL = '/pyodide/0.28.2/';
const VIZ_HELPER_URL = '/viz-helpers/graph_viz_helper.py';

let pyodide = null;
let initPromise = null;
let vizHelperCode = null;

/**
 * Initialize Pyodide runtime
 */
async function initPyodide() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const absoluteBase = `${self.location.origin}${PYODIDE_BASE_URL}`;

      console.log('[ShadowRunner] Initializing Pyodide from:', absoluteBase);

      // Fetch and execute pyodide.js
      const response = await fetch(absoluteBase + 'pyodide.js');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const pyodideScript = await response.text();
      (0, eval)(pyodideScript);

      const loadPyodide = self.loadPyodide;
      if (!loadPyodide) {
        throw new Error('loadPyodide not found after executing pyodide.js');
      }

      // Load Pyodide
      pyodide = await loadPyodide({
        indexURL: absoluteBase,
        stdout: (text) => console.log('[ShadowRunner stdout]:', text),
        stderr: (text) => console.error('[ShadowRunner stderr]:', text),
      });

      console.log('[ShadowRunner] Pyodide initialized successfully');

      // Fetch Viz Helper
      try {
        const vizResponse = await fetch(`${self.location.origin}${VIZ_HELPER_URL}`);
        if (vizResponse.ok) {
          vizHelperCode = await vizResponse.text();
          console.log('[ShadowRunner] Viz Helper fetched successfully');
          // Pre-load helper into global namespace
          await pyodide.runPythonAsync(vizHelperCode);
        } else {
          console.warn('[ShadowRunner] Failed to fetch Viz Helper');
        }
      } catch (e) {
        console.warn('[ShadowRunner] Error fetching Viz Helper:', e);
      }

      // Setup detailed Python environment (including run_tests)
      await pyodide.runPythonAsync(`
import sys
import io
import json
import time
import traceback

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

def run_tests(code_str, test_cases_json):
    """Run user code and test cases (Simplified version for Shadow Runner)"""
    test_cases = json.loads(test_cases_json)
    results = []
    
    # Execute user code in a namespace
    user_namespace = {
        '__file__': '/workspace/solution.py',
        '__name__': '__pyodide_exec__'
    }
    
    # Re-inject viz helper functions if they exist in global scope but not here
    # (Though globals should be accessible if we don't block them)
    
    exec(code_str, user_namespace)
    
    # Run each test case
    for test in test_cases:
        test_id = test.get('id', '')
        fn_name = test.get('fn', 'solve')
        args = test.get('args', [])
        expected = test.get('expected')

        start_time = time.time()
        result = {
            'id': test_id,
            'fn': fn_name,
            'passed': False,
            'durationMs': 0,
        }

        try:
            if fn_name not in user_namespace:
                result['error'] = f"Function '{fn_name}' not found"
                result['passed'] = False
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
            
            # --- VIZ TRIGGER ---
            # Try to capture visualization using the injected helper
            try:
                if 'dump_viz' in globals():
                    # We pass locals() of the current frame (run_tests scope)
                    # But we really want variable from the EXEC scope (user_namespace)
                    # user_namespace contains the user's variables/state after execution
                    globals()['dump_viz'](user_namespace)
            except Exception as viz_err:
                # Fail silently for viz generation to not mask original error
                pass
            
        finally:
            result['durationMs'] = (time.time() - start_time) * 1000
            results.append(result)
    
    return results
      `);

      return pyodide;
    } catch (error) {
      console.error('[ShadowRunner] Initialization failed:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Run Python code with the given inputs or test cases
 */
async function runCode(code, inputsOrTests) {
  if (!pyodide) {
    await initPyodide();
  }

  try {
    const isTestRun = Array.isArray(inputsOrTests) && inputsOrTests.length > 0 && typeof inputsOrTests[0] === 'object' && 'fn' in inputsOrTests[0];
    const inputs = isTestRun ? [] : (inputsOrTests || []);
    const testCases = isTestRun ? inputsOrTests : [];

    // Inject Viz Helper if available and not already present (it's loaded in init, but let's be safe)
    // Actually, init loads it into global.

    const runScript = `
import json
import sys
import io

_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
_original_stdout = sys.stdout
_original_stderr = sys.stderr
_result = None
_test_results = None

try:
    sys.stdout = _stdout_capture
    sys.stderr = _stderr_capture
    
    # We will use the run_tests function if testCases are present
    if ${isTestRun ? 'True' : 'False'}:
         _test_results = run_tests(${JSON.stringify(code)}, ${JSON.stringify(JSON.stringify(testCases))})
         _result = _test_results
    else:
        # Standard execution mode (legacy)
        _inputs = json.loads(${JSON.stringify(JSON.stringify(inputs))})
        _namespace = {
            '__name__': '__main__',
            'inputs': _inputs,
            'INPUTS': _inputs
        }
        exec(${JSON.stringify(code)}, _namespace)
        if 'result' in _namespace:
            _result = _namespace['result']
        elif 'output' in _namespace:
            _result = _namespace['output']
        else:
            _result = _stdout_capture.getvalue()

except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"\\nError: {str(e)}", file=sys.stderr)
    # Re-raise so JS knows it failed? Or just capture in stderr?
    # We want to return success: false
    raise e

finally:
    sys.stdout = _original_stdout
    sys.stderr = _original_stderr

_captured_stdout = _stdout_capture.getvalue()
_captured_stderr = _stderr_capture.getvalue()

json.dumps({
    'result': _result,
    'stdout': _captured_stdout,
    'stderr': _captured_stderr
})
    `;

    const resultJson = await pyodide.runPythonAsync(runScript);
    const parsed = JSON.parse(resultJson);

    return {
      success: true,
      output: parsed.result,
      stdout: parsed.stdout,
      stderr: parsed.stderr
    };

  } catch (error) {
    console.error('[ShadowRunner] Execution error:', error);

    let errorMessage = error.message || String(error);
    if (errorMessage.includes('Traceback')) {
      const lines = errorMessage.split('\n');
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2];
      if (lastLine && lastLine.trim()) {
        errorMessage = lastLine.trim();
      }
    }

    return {
      success: false,
      output: null,
      error: errorMessage
    };
  }
}

// Handle incoming messages
self.addEventListener('message', async (event) => {
  // Support both old {code, inputs} and new {code, testCases} formats
  // But also the new {code, inputs} might be ambiguous if inputs is array of objects.
  // We'll trust runCode to distinguish or we handle here.

  const { code, inputs, testCases } = event.data;

  console.log('[ShadowRunner] Received execution request');

  if (typeof code !== 'string') {
    self.postMessage({
      success: false,
      output: null,
      error: 'Code must be a string'
    });
    return;
  }

  try {
    // Pass testCases if available, otherwise inputs
    const data = testCases || inputs;
    const result = await runCode(code, data);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      success: false,
      output: null,
      error: error.message || 'Unknown execution error'
    });
  }
});

// Initialize Pyodide immediately
initPyodide().catch(err => {
  console.error('[ShadowRunner] Background initialization failed:', err);
});

console.log('[ShadowRunner] Worker loaded and ready');
