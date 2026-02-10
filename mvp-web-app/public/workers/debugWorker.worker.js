/**
 * Debug Worker — Step-Through Debugger Engine
 *
 * A dedicated Web Worker that runs Python code with sys.settrace enabled
 * to collect a full execution trace (line-by-line snapshots of variables,
 * call stack, and stdout). The main thread can then replay the trace
 * step-by-step in the DebugPanel UI.
 *
 * Messages:
 *   IN:  { cmd: "DEBUG", code: string, maxSteps?: number }
 *   IN:  { cmd: "DEBUG_MULTI", files: Record<string, string>, entryFile: string, maxSteps?: number }
 *   OUT: { cmd: "TRACE_RESULT", steps: DebugStep[], truncated: boolean, error?: string }
 *   OUT: { cmd: "READY" }
 *   OUT: { cmd: "ERROR", error: string }
 */

// Polyfill for Object.hasOwn (ES2022) - required for older Safari versions
if (!Object.hasOwn) {
  Object.hasOwn = function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

const PYODIDE_BASE_URL = '/pyodide/0.28.2/';
const DEFAULT_MAX_STEPS = 2000;
const WORKSPACE_PREFIX = '/workspace/';

let pyodide = null;
let initPromise = null;

/**
 * Initialize Pyodide runtime and load the tracer module.
 */
async function initPyodide() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const absoluteBase = `${self.location.origin}${PYODIDE_BASE_URL}`;

      console.log('[DebugWorker] Initializing Pyodide from:', absoluteBase);

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

      pyodide = await loadPyodide({
        indexURL: absoluteBase,
        stdout: () => {},
        stderr: () => {},
      });

      console.log('[DebugWorker] Pyodide initialized successfully');

      // Load the tracer module into Pyodide
      await pyodide.runPythonAsync(TRACER_MODULE);

      console.log('[DebugWorker] Tracer module loaded');

      return pyodide;
    } catch (error) {
      console.error('[DebugWorker] Initialization failed:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Python tracer module injected into Pyodide.
 *
 * Uses sys.settrace to hook into CPython's line/call/return events.
 * Supports both single-file (exec) and multi-file (VFS + compile) modes.
 *
 * Each step: { file, line, stack: [{fn, file, line}], variables, output }
 */
const TRACER_MODULE = `
import sys
import io
import json
import os

WORKSPACE = '/workspace'

class StepTracer:
    """
    A sys.settrace-based tracer that records one DebugStep per source line
    executed in user code. Supports multi-file tracing via /workspace/ VFS.
    """

    def __init__(self, max_steps=2000, allowed_prefixes=None):
        self.steps = []
        self.max_steps = max_steps
        self.truncated = False
        self._stdout = io.StringIO()
        self._last_stdout_pos = 0
        self._original_stdout = None
        self._original_stderr = None
        self._stderr_capture = io.StringIO()
        self._active = False
        # Prefixes of filenames we should trace (e.g. ['/workspace/'])
        # For single-file mode: ['<exec>', '<string>']
        self._allowed_prefixes = allowed_prefixes or ['<exec>', '<string>', '<module>']

    def start(self):
        """Redirect stdout and install the trace function."""
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr
        sys.stdout = self._stdout
        sys.stderr = self._stderr_capture
        self._active = True
        sys.settrace(self._trace_dispatch)

    def stop(self):
        """Remove the trace function and restore stdout."""
        sys.settrace(None)
        self._active = False
        if self._original_stdout:
            sys.stdout = self._original_stdout
        if self._original_stderr:
            sys.stderr = self._original_stderr

    def _is_user_file(self, filename):
        """Check if a filename belongs to user code we should trace."""
        for prefix in self._allowed_prefixes:
            if filename == prefix or filename.startswith(prefix):
                return True
        return False

    def _display_filename(self, filename):
        """Convert internal filename to display name."""
        if filename.startswith(WORKSPACE + '/'):
            return filename[len(WORKSPACE) + 1:]  # strip '/workspace/'
        if filename in ('<exec>', '<string>', '<module>'):
            return None  # single-file mode, no filename needed
        return filename

    # ── trace dispatch ────────────────────────────────────────────

    def _trace_dispatch(self, frame, event, arg):
        filename = frame.f_code.co_filename
        if not self._is_user_file(filename):
            return self._trace_dispatch

        if len(self.steps) >= self.max_steps:
            self.truncated = True
            sys.settrace(None)
            return None

        if event == 'call':
            return self._trace_dispatch

        if event == 'return':
            return self._trace_dispatch

        if event == 'line':
            self._record_step(frame)
            return self._trace_dispatch

        return self._trace_dispatch

    # ── variable serialization ────────────────────────────────────

    @staticmethod
    def _serialize_value(val, depth=0, max_depth=2, max_str_len=200):
        """Serialize a Python value into a JSON-safe representation."""
        import types as _types
        import inspect as _inspect

        if val is None or isinstance(val, (bool, int, float)):
            return val

        if isinstance(val, str):
            if len(val) > max_str_len:
                return val[:max_str_len] + '...'
            return val

        if isinstance(val, (_types.FunctionType, _types.MethodType,
                            _types.BuiltinFunctionType, _types.BuiltinMethodType,
                            _types.ModuleType)):
            return None
        if isinstance(val, type):
            return None
        if _inspect.isroutine(val):
            return None

        if depth >= max_depth:
            try:
                s = repr(val)
                return s[:max_str_len] if len(s) > max_str_len else s
            except Exception:
                return '<...>'

        if isinstance(val, dict):
            result = {}
            for k, v in list(val.items())[:50]:
                sk = str(k)
                sv = StepTracer._serialize_value(v, depth + 1, max_depth, max_str_len)
                if sv is not None:
                    result[sk] = sv
            return result

        if isinstance(val, (list, tuple)):
            items = []
            for item in val[:50]:
                sv = StepTracer._serialize_value(item, depth + 1, max_depth, max_str_len)
                items.append(sv if sv is not None else None)
            return items

        if isinstance(val, (set, frozenset)):
            items = []
            for item in list(val)[:50]:
                sv = StepTracer._serialize_value(item, depth + 1, max_depth, max_str_len)
                items.append(sv if sv is not None else None)
            return items

        if hasattr(val, '__dict__') and not isinstance(val, type):
            result = {}
            for k, v in list(vars(val).items())[:50]:
                if k.startswith('__'):
                    continue
                sv = StepTracer._serialize_value(v, depth + 1, max_depth, max_str_len)
                if sv is not None:
                    result[k] = sv
            return result

        try:
            s = repr(val)
            return s[:max_str_len] if len(s) > max_str_len else s
        except Exception:
            return '<unrepresentable>'

    # ── rich call stack builder ───────────────────────────────────

    def _build_rich_stack(self, frame):
        """Walk the frame chain to build a rich call stack with file+line per frame."""
        frames = []
        f = frame
        while f is not None:
            filename = f.f_code.co_filename
            if self._is_user_file(filename):
                display = self._display_filename(filename)
                frames.append({
                    'fn': f.f_code.co_name,
                    'file': display,
                    'line': f.f_lineno,
                })
            f = f.f_back
        frames.reverse()  # outermost first, current frame last
        return frames

    # ── step recording ────────────────────────────────────────────

    def _record_step(self, frame):
        # Capture stdout delta since last step
        current_pos = self._stdout.tell()
        output_delta = ''
        if current_pos > self._last_stdout_pos:
            self._stdout.seek(self._last_stdout_pos)
            output_delta = self._stdout.read()
            self._stdout.seek(0, 2)
            self._last_stdout_pos = current_pos

        # Rich call stack with file+line per frame
        stack = self._build_rich_stack(frame)

        # Display filename for this step
        display_file = self._display_filename(frame.f_code.co_filename)

        # Capture local variables
        variables = {}
        for key, val in frame.f_locals.items():
            if key.startswith('__') and key.endswith('__'):
                continue
            if key.startswith('_') and key != '_':
                continue
            serialized = StepTracer._serialize_value(val)
            if serialized is not None:
                variables[key] = serialized

        self.steps.append({
            'file': display_file,
            'line': frame.f_lineno,
            'stack': stack,
            'variables': variables,
            'output': output_delta,
        })

    # ── results ───────────────────────────────────────────────────

    def get_results(self):
        """Return the collected trace as a JSON string."""
        return json.dumps({
            'steps': self.steps,
            'truncated': self.truncated,
        })


def setup_workspace(files_json):
    """Write files to /workspace/ VFS and add to sys.path."""
    import json
    files = json.loads(files_json)
    os.makedirs(WORKSPACE, exist_ok=True)
    if WORKSPACE not in sys.path:
        sys.path.insert(0, WORKSPACE)
    for name, content in files.items():
        filepath = os.path.join(WORKSPACE, name)
        dirpath = os.path.dirname(filepath)
        if dirpath and dirpath != WORKSPACE:
            os.makedirs(dirpath, exist_ok=True)
        with open(filepath, 'w') as f:
            f.write(content)
    return list(files.keys())
`;

/**
 * Run single-file code with tracing enabled (backward-compatible).
 */
async function runDebug(code, maxSteps) {
  if (!pyodide) {
    await initPyodide();
  }

  const steps = maxSteps || DEFAULT_MAX_STEPS;

  const debugScript = `
import json as _json

_tracer = StepTracer(max_steps=${steps})

_exec_error = None
try:
    _tracer.start()
    exec(${JSON.stringify(code)}, {'__name__': '__pyodide_exec__'})
except Exception as _e:
    _exec_error = str(_e)
finally:
    _tracer.stop()

_trace_result = _json.loads(_tracer.get_results())
if _exec_error:
    _trace_result['error'] = _exec_error

_json.dumps(_trace_result)
  `;

  const resultJson = await pyodide.runPythonAsync(debugScript);
  return JSON.parse(resultJson);
}

/**
 * Run multi-file project with tracing enabled.
 * Files are written to /workspace/ VFS and executed with real filenames.
 */
async function runDebugMulti(files, entryFile, maxSteps) {
  if (!pyodide) {
    await initPyodide();
  }

  const steps = maxSteps || DEFAULT_MAX_STEPS;
  const filesJson = JSON.stringify(files);
  const entryPath = WORKSPACE_PREFIX + entryFile;

  const debugScript = `
import json as _json
import os as _os

# Write files to VFS
setup_workspace(${JSON.stringify(filesJson)})

# Read entry file content
_entry_path = ${JSON.stringify(entryPath)}
_entry_file = ${JSON.stringify(entryFile)}
with open(_entry_path, 'r') as _f:
    _entry_code = _f.read()

# Compile with real filename so sys.settrace sees it
_compiled = compile(_entry_code, _entry_path, 'exec')

# Create tracer that accepts /workspace/ files
_tracer = StepTracer(
    max_steps=${steps},
    allowed_prefixes=['/workspace/']
)

_exec_error = None
_namespace = {'__name__': '__main__', '__file__': _entry_path}
try:
    _tracer.start()
    exec(_compiled, _namespace)
except Exception as _e:
    _exec_error = str(_e)
finally:
    _tracer.stop()

_trace_result = _json.loads(_tracer.get_results())
if _exec_error:
    _trace_result['error'] = _exec_error

_json.dumps(_trace_result)
  `;

  const resultJson = await pyodide.runPythonAsync(debugScript);
  return JSON.parse(resultJson);
}

// ── Message Handler ──────────────────────────────────────────────

self.addEventListener('message', async (event) => {
  const { cmd, code, files, entryFile, maxSteps } = event.data;

  if (cmd === 'INIT') {
    try {
      await initPyodide();
      self.postMessage({ cmd: 'READY' });
    } catch (error) {
      self.postMessage({ cmd: 'ERROR', error: error.message || 'Init failed' });
    }
    return;
  }

  if (cmd === 'DEBUG') {
    if (typeof code !== 'string') {
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: [],
        truncated: false,
        error: 'Code must be a string',
      });
      return;
    }

    try {
      const result = await runDebug(code, maxSteps);
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: result.steps || [],
        truncated: result.truncated || false,
        error: result.error || null,
      });
    } catch (error) {
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: [],
        truncated: false,
        error: error.message || 'Debug execution failed',
      });
    }
    return;
  }

  if (cmd === 'DEBUG_MULTI') {
    if (!files || typeof files !== 'object' || !entryFile) {
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: [],
        truncated: false,
        error: 'DEBUG_MULTI requires files (object) and entryFile (string)',
      });
      return;
    }

    try {
      const result = await runDebugMulti(files, entryFile, maxSteps);
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: result.steps || [],
        truncated: result.truncated || false,
        error: result.error || null,
      });
    } catch (error) {
      self.postMessage({
        cmd: 'TRACE_RESULT',
        steps: [],
        truncated: false,
        error: error.message || 'Multi-file debug execution failed',
      });
    }
    return;
  }

  console.warn('[DebugWorker] Unknown command:', cmd);
});

// Initialize Pyodide eagerly in background
initPyodide().then(() => {
  self.postMessage({ cmd: 'READY' });
}).catch(err => {
  console.error('[DebugWorker] Background init failed:', err);
});

console.log('[DebugWorker] Worker loaded');
