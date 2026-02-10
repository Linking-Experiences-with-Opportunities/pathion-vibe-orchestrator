/**
 * Generates Python custom test harness code for executing test cases
 * This avoids importing unittest which is blocked by the sandbox policy
 * @param testsToRun - Array of test method names to execute
 * @param className - Optional test class name (defaults to 'TestName')
 * @returns Python code string with no leading indentation
 */
export function generateUnittestRunnerCode(
  testsToRun: string[],
  className?: string
): string {
  const testClass = className || 'TestName';
  const testMethodCalls = testsToRun
    .map(testName => `    run_test('${testName}')`)
    .join('\n');

  return `# === Test Runner ===
import sys
import io
import json
import time
import traceback

test_results = []
test_output = []
_failing_test_locals = {}

# Import dump_viz from Pyodide main scope (defined in PYTHON_MODULES)
try:
    _dump_viz = sys.modules['__main__'].dump_viz
except (KeyError, AttributeError):
    _dump_viz = None

def run_test(test_name):
    """Run a single test method and capture results + per-test stdout"""
    global _failing_test_locals
    start_time = time.time()
    test_instance = None
    # Redirect stdout to capture per-test print() output
    _test_cap = io.StringIO()
    _orig_stdout = sys.stdout
    sys.stdout = _test_cap
    try:
        # Get the test class from global namespace
        if '${testClass}' not in globals():
            test_results.append({
                'name': test_name,
                'status': 'error',
                'duration': 0,
                'message': f"Test class '${testClass}' not found",
                'output': ''
            })
            return
        
        test_class = globals()['${testClass}']
        test_instance = test_class()
        # Expose instance for invariant extraction by dump_viz
        globals()['_last_tested_instance'] = test_instance
        
        # Check if test method exists
        if not hasattr(test_instance, test_name):
            test_results.append({
                'name': test_name,
                'status': 'error',
                'duration': 0,
                'message': f"Test method '{test_name}' not found in class '${testClass}'",
                'output': ''
            })
            return
        
        # Run setup if it exists
        if hasattr(test_instance, 'setUp'):
            test_instance.setUp()
        
        # Run the test method
        test_method = getattr(test_instance, test_name)
        test_method()
        
        # Run teardown if it exists
        if hasattr(test_instance, 'tearDown'):
            test_instance.tearDown()
        
        # Test passed
        duration = (time.time() - start_time) * 1000
        test_results.append({
            'name': test_name,
            'status': 'pass',
            'duration': duration,
            'output': _test_cap.getvalue()
        })
        test_output.append(f"PASS: {test_name}")
        
    except AssertionError as e:
        # Test failed (assertion error)
        duration = (time.time() - start_time) * 1000
        error_msg = str(e) if str(e) else "Assertion failed"
        test_results.append({
            'name': test_name,
            'status': 'fail',
            'duration': duration,
            'message': error_msg,
            'output': _test_cap.getvalue()
        })
        test_output.append(f"FAIL: {test_name}")
        test_output.append(f"  {error_msg}")
        # Capture failing test's local variables for viz
        try:
            _tb = sys.exc_info()[2]
            if _tb and _tb.tb_next:
                _frame_locals = dict(_tb.tb_next.tb_frame.f_locals)
                _frame_locals.pop('self', None)
                _failing_test_locals.update(_frame_locals)
        except Exception:
            pass
        
    except Exception as e:
        # Test error (exception during execution)
        duration = (time.time() - start_time) * 1000
        error_trace = traceback.format_exc()
        error_msg = str(e) if str(e) else "Unknown error"
        test_results.append({
            'name': test_name,
            'status': 'error',
            'duration': duration,
            'message': error_msg,
            'output': _test_cap.getvalue()
        })
        test_output.append(f"ERROR: {test_name}")
        test_output.append(f"  {error_msg}")
        test_output.append(error_trace)
        # Capture failing test's local variables for viz
        try:
            _tb = sys.exc_info()[2]
            if _tb and _tb.tb_next:
                _frame_locals = dict(_tb.tb_next.tb_frame.f_locals)
                _frame_locals.pop('self', None)
                _failing_test_locals.update(_frame_locals)
        except Exception:
            pass
    finally:
        sys.stdout = _orig_stdout

def __run_unittest__():
    """Main test runner function"""
    total_tests = len(test_results)
    failures = sum(1 for r in test_results if r['status'] == 'fail')
    errors = sum(1 for r in test_results if r['status'] == 'error')
    success = failures == 0 and errors == 0
    
    # Run all tests
${testMethodCalls}
    
    # Update totals after running tests
    total_tests = len(test_results)
    failures = sum(1 for r in test_results if r['status'] == 'fail')
    errors = sum(1 for r in test_results if r['status'] == 'error')
    success = failures == 0 and errors == 0
    
    # Print JSON results
    print("\\n=== TEST_RESULTS_JSON_START ===")
    print(json.dumps({
        'results': test_results,
        'total': total_tests,
        'failures': failures,
        'errors': errors,
        'success': success
    }))
    print("=== TEST_RESULTS_JSON_END ===")
    
    # Print test output
    for line in test_output:
        print(line)
    
    # Emit viz payload for failing tests
    # _dump_viz imported from Pyodide __main__ scope at template top
    if not success and _dump_viz is not None:
        try:
            # Build viz dict from failing test locals + last tested instance
            _viz_dict = dict(_failing_test_locals) if _failing_test_locals else {}
            _inst = globals().get('_last_tested_instance')
            if _inst is not None:
                _viz_dict['_last_tested_instance'] = _inst
            if _viz_dict:
                _dump_viz(_viz_dict)
        except Exception:
            pass
    
    return 0 if success else 1
`;
}

