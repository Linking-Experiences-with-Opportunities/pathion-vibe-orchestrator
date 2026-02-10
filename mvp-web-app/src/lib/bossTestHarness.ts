/**
 * Boss Test Harness: Python code templates injected into the Pyodide runner
 * to adversarially test a student's ArrayList implementation.
 *
 * Each "boss script" is a function of (seedArray, className) that returns
 * a complete Python script string. The script:
 *   1. Instantiates the student's ArrayList (detected class name)
 *   2. Adds all seed values
 *   3. Runs an "attack sequence" tailored to the target method
 *   4. Verifies invariants (size, ordering, bounds)
 *   5. Prints a structured JSON result to stdout
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayToPythonList(arr: number[]): string {
  return `[${arr.join(", ")}]`;
}

/**
 * Detect the primary class name from student code.
 *
 * Scans for `class XXX:` or `class XXX(` declarations, preferring classes
 * that contain ArrayList-like methods (add, insert, remove, get, size).
 * Falls back to the first class found, or "ArrayList" if none detected.
 */
export function detectClassName(code: string): string {
  // Match all class declarations
  const classRegex = /^class\s+(\w+)\s*[:(]/gm;
  const classes: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(code)) !== null) {
    classes.push(match[1]);
  }

  if (classes.length === 0) return "ArrayList";
  if (classes.length === 1) return classes[0];

  // If multiple classes, prefer the one with ArrayList-like methods
  const arrayListMethods = ["add", "insert", "remove", "get", "size"];
  for (const cls of classes) {
    // Find the class body (from "class Foo" to the next top-level class or EOF)
    const clsPattern = new RegExp(
      `class\\s+${cls}\\s*[:(][\\s\\S]*?(?=\\nclass\\s+\\w|$)`,
      "m"
    );
    const clsMatch = clsPattern.exec(code);
    if (clsMatch) {
      const body = clsMatch[0];
      const methodCount = arrayListMethods.filter((m) =>
        new RegExp(`def\\s+_?${m}\\s*\\(`).test(body)
      ).length;
      if (methodCount >= 3) return cls;
    }
  }

  return classes[0];
}

// ---------------------------------------------------------------------------
// Attack scripts — all parameterised by `cls` (the student's class name)
// ---------------------------------------------------------------------------

/**
 * Attack A: Resize + Integrity Check
 *
 * Adds all seed values (forces resize on typical capacity=4/8 implementations),
 * then adds a few more to push past the next boundary, then verifies get(i)
 * returns the correct value for every index and size() is correct.
 */
function attackResize(seedArray: number[], cls: string): string {
  return `
seed = ${arrayToPythonList(seedArray)}
extra = [seed[-1] if seed else 99] * 5

al = ${cls}()

# Phase 1: add all seed values
for x in seed:
    al.add(x)

expected_size = len(seed)
actual_size = al.size()
if actual_size != expected_size:
    result = {
        "pass": False,
        "failingTest": "resize_seed_size",
        "expected": expected_size,
        "actual": actual_size,
        "error": f"After adding {expected_size} seed values, size() returned {actual_size}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Check integrity after seed adds
for i in range(len(seed)):
    val = al.get(i)
    if val != seed[i]:
        result = {
            "pass": False,
            "failingTest": "resize_seed_integrity",
            "expected": seed[i],
            "actual": val,
            "error": f"get({i}) returned {val}, expected {seed[i]} after adding seed values"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Phase 2: add extra values to force boundary
for x in extra:
    al.add(x)

total_expected = len(seed) + len(extra)
actual_total = al.size()
if actual_total != total_expected:
    result = {
        "pass": False,
        "failingTest": "resize_extra_size",
        "expected": total_expected,
        "actual": actual_total,
        "error": f"After adding {len(extra)} extra values, size() returned {actual_total}, expected {total_expected}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Verify first and last element
first = al.get(0)
last = al.get(total_expected - 1)

all_expected = seed + extra

if first != all_expected[0]:
    result = {
        "pass": False,
        "failingTest": "resize_first_element",
        "expected": all_expected[0],
        "actual": first,
        "error": f"get(0) returned {first}, expected {all_expected[0]}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

if last != all_expected[-1]:
    result = {
        "pass": False,
        "failingTest": "resize_last_element",
        "expected": all_expected[-1],
        "actual": last,
        "error": f"get({total_expected - 1}) returned {last}, expected {all_expected[-1]}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Full integrity check
for i in range(total_expected):
    val = al.get(i)
    if val != all_expected[i]:
        result = {
            "pass": False,
            "failingTest": "resize_full_integrity",
            "expected": all_expected[i],
            "actual": val,
            "error": f"get({i}) returned {val}, expected {all_expected[i]} after resize"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

result = {"pass": True}
print("BOSS_RESULT:" + __import__('json').dumps(result))
`;
}

/**
 * Attack B: Insert shift correctness
 *
 * Adds all seed values, then inserts sentinels at index 0, mid, and end.
 * Verifies order and size after each insertion.
 */
function attackInsert(seedArray: number[], cls: string): string {
  return `
seed = ${arrayToPythonList(seedArray)}
SENTINEL_FRONT = -9999
SENTINEL_MID = -8888
SENTINEL_END = -7777

al = ${cls}()

for x in seed:
    al.add(x)

expected = list(seed)

# Insert at front
al.insert(0, SENTINEL_FRONT)
expected.insert(0, SENTINEL_FRONT)

if al.size() != len(expected):
    result = {
        "pass": False,
        "failingTest": "insert_front_size",
        "expected": len(expected),
        "actual": al.size(),
        "error": f"After insert(0, sentinel), size() is {al.size()}, expected {len(expected)}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

if al.get(0) != SENTINEL_FRONT:
    result = {
        "pass": False,
        "failingTest": "insert_front_value",
        "expected": SENTINEL_FRONT,
        "actual": al.get(0),
        "error": f"After insert(0, sentinel), get(0) returned {al.get(0)}, expected {SENTINEL_FRONT}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Insert at mid
mid = len(expected) // 2
al.insert(mid, SENTINEL_MID)
expected.insert(mid, SENTINEL_MID)

if al.size() != len(expected):
    result = {
        "pass": False,
        "failingTest": "insert_mid_size",
        "expected": len(expected),
        "actual": al.size(),
        "error": f"After insert({mid}, sentinel), size() is {al.size()}, expected {len(expected)}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

if al.get(mid) != SENTINEL_MID:
    result = {
        "pass": False,
        "failingTest": "insert_mid_value",
        "expected": SENTINEL_MID,
        "actual": al.get(mid),
        "error": f"After insert({mid}, sentinel), get({mid}) returned {al.get(mid)}, expected {SENTINEL_MID}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Insert at end (should behave like add)
end_idx = len(expected)
al.insert(end_idx, SENTINEL_END)
expected.insert(end_idx, SENTINEL_END)

if al.size() != len(expected):
    result = {
        "pass": False,
        "failingTest": "insert_end_size",
        "expected": len(expected),
        "actual": al.size(),
        "error": f"After insert({end_idx}, sentinel), size() is {al.size()}, expected {len(expected)}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Verify full order
for i in range(len(expected)):
    val = al.get(i)
    if val != expected[i]:
        result = {
            "pass": False,
            "failingTest": "insert_order_check",
            "expected": expected[i],
            "actual": val,
            "error": f"After inserts, get({i}) returned {val}, expected {expected[i]}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

result = {"pass": True}
print("BOSS_RESULT:" + __import__('json').dumps(result))
`;
}

/**
 * Attack C: Remove shift correctness
 *
 * Adds all seed values, then removes at index 0, mid, and last.
 * Verifies remaining order and size.
 */
function attackRemove(seedArray: number[], cls: string): string {
  return `
seed = ${arrayToPythonList(seedArray)}

al = ${cls}()

for x in seed:
    al.add(x)

expected = list(seed)

if len(expected) < 3:
    # Need at least 3 elements to run full remove attack
    result = {"pass": True}
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Remove at front
al.remove(0)
expected.pop(0)

if al.size() != len(expected):
    result = {
        "pass": False,
        "failingTest": "remove_front_size",
        "expected": len(expected),
        "actual": al.size(),
        "error": f"After remove(0), size() is {al.size()}, expected {len(expected)}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Verify first element shifted correctly
if len(expected) > 0 and al.get(0) != expected[0]:
    result = {
        "pass": False,
        "failingTest": "remove_front_shift",
        "expected": expected[0],
        "actual": al.get(0),
        "error": f"After remove(0), get(0) returned {al.get(0)}, expected {expected[0]}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

# Remove at mid
if len(expected) >= 2:
    mid = len(expected) // 2
    al.remove(mid)
    expected.pop(mid)

    if al.size() != len(expected):
        result = {
            "pass": False,
            "failingTest": "remove_mid_size",
            "expected": len(expected),
            "actual": al.size(),
            "error": f"After remove({mid}), size() is {al.size()}, expected {len(expected)}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Remove at last
if len(expected) >= 1:
    last_idx = len(expected) - 1
    al.remove(last_idx)
    expected.pop(last_idx)

    if al.size() != len(expected):
        result = {
            "pass": False,
            "failingTest": "remove_last_size",
            "expected": len(expected),
            "actual": al.size(),
            "error": f"After remove(last), size() is {al.size()}, expected {len(expected)}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Verify remaining order
for i in range(len(expected)):
    val = al.get(i)
    if val != expected[i]:
        result = {
            "pass": False,
            "failingTest": "remove_order_check",
            "expected": expected[i],
            "actual": val,
            "error": f"After removes, get({i}) returned {val}, expected {expected[i]}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

result = {"pass": True}
print("BOSS_RESULT:" + __import__('json').dumps(result))
`;
}

/**
 * Generic fallback attack -- runs all three attacks in sequence.
 * Stops at the first failure.
 */
function attackGeneric(seedArray: number[], cls: string): string {
  return `
seed = ${arrayToPythonList(seedArray)}

al = ${cls}()
expected = []

# Phase 1: add all seed values
for x in seed:
    al.add(x)
    expected.append(x)

if al.size() != len(expected):
    result = {
        "pass": False,
        "failingTest": "generic_add_size",
        "expected": len(expected),
        "actual": al.size(),
        "error": f"After adding seed, size() is {al.size()}, expected {len(expected)}"
    }
    print("BOSS_RESULT:" + __import__('json').dumps(result))
    raise SystemExit(0)

for i in range(len(expected)):
    val = al.get(i)
    if val != expected[i]:
        result = {
            "pass": False,
            "failingTest": "generic_add_integrity",
            "expected": expected[i],
            "actual": val,
            "error": f"get({i}) returned {val}, expected {expected[i]}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Phase 2: insert a sentinel at front
if len(expected) > 0:
    al.insert(0, -9999)
    expected.insert(0, -9999)

    if al.size() != len(expected):
        result = {
            "pass": False,
            "failingTest": "generic_insert_size",
            "expected": len(expected),
            "actual": al.size(),
            "error": f"After insert(0, -9999), size() is {al.size()}, expected {len(expected)}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

    if al.get(0) != -9999:
        result = {
            "pass": False,
            "failingTest": "generic_insert_value",
            "expected": -9999,
            "actual": al.get(0),
            "error": f"After insert(0, -9999), get(0) returned {al.get(0)}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Phase 3: remove at front
if len(expected) > 1:
    al.remove(0)
    expected.pop(0)

    if al.size() != len(expected):
        result = {
            "pass": False,
            "failingTest": "generic_remove_size",
            "expected": len(expected),
            "actual": al.size(),
            "error": f"After remove(0), size() is {al.size()}, expected {len(expected)}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

# Full order check
for i in range(len(expected)):
    val = al.get(i)
    if val != expected[i]:
        result = {
            "pass": False,
            "failingTest": "generic_final_order",
            "expected": expected[i],
            "actual": val,
            "error": f"Final check: get({i}) returned {val}, expected {expected[i]}"
        }
        print("BOSS_RESULT:" + __import__('json').dumps(result))
        raise SystemExit(0)

result = {"pass": True}
print("BOSS_RESULT:" + __import__('json').dumps(result))
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete Python "boss test" script string.
 *
 * The returned code expects the student's class to already be defined in the
 * execution namespace (i.e., the student code is executed first, then this
 * script runs immediately afterwards).
 *
 * @param targetMethod The method the boss is attacking (resize, insert, remove, etc.)
 * @param seedArray    The adversarial seed values to test with
 * @param className    The student's class name (auto-detected via detectClassName)
 *
 * The script prints exactly one line matching `BOSS_RESULT:{json}` that
 * the caller should parse.
 */
export function generateBossScript(
  targetMethod: string,
  seedArray: number[],
  className: string = "ArrayList"
): string {
  let attackCode: string;

  switch (targetMethod) {
    case "resize":
    case "grow":
    case "add":
      attackCode = attackResize(seedArray, className);
      break;
    case "insert":
      attackCode = attackInsert(seedArray, className);
      break;
    case "remove":
      attackCode = attackRemove(seedArray, className);
      break;
    default:
      attackCode = attackGeneric(seedArray, className);
      break;
  }

  // Wrap in try/except so runtime errors are reported, not swallowed
  return `
import json as _json

try:
${attackCode
  .split("\n")
  .map((line) => "    " + line)
  .join("\n")}
except IndexError as _e:
    _result = {
        "pass": False,
        "failingTest": "boss_index_error",
        "expected": "no IndexError",
        "actual": str(_e),
        "error": f"IndexError raised during boss attack: {_e}"
    }
    print("BOSS_RESULT:" + _json.dumps(_result))
except Exception as _e:
    _result = {
        "pass": False,
        "failingTest": "boss_runtime_error",
        "expected": "no error",
        "actual": str(_e),
        "error": f"Runtime error during boss attack: {type(_e).__name__}: {_e}"
    }
    print("BOSS_RESULT:" + _json.dumps(_result))
`;
}

/**
 * Strip `### File: ...` header lines from a multi-file code snapshot,
 * returning clean Python code that can be executed directly.
 */
export function stripFileHeaders(codeSnapshot: string): string {
  return codeSnapshot
    .split("\n")
    .filter((line) => !line.startsWith("### File:"))
    .join("\n");
}

/**
 * Generate a readable Python user-test function that reproduces the boss
 * fight failure. The student can paste this into their User Tests tab
 * and iterate on fixing the bug.
 *
 * @param targetMethod  The method the boss attacked (insert, remove, resize, etc.)
 * @param seedArray     The (possibly minimised) seed array that triggers the bug
 * @param className     The student's class name (e.g. MyArrayList)
 * @param failingTest   Optional boss check name for the comment
 * @param errorLog      Optional error description for the comment
 */
export function generateUserTestCode(
  targetMethod: string,
  seedArray: number[],
  className: string,
  failingTest?: string,
  errorLog?: string
): string {
  const seed = `[${seedArray.join(", ")}]`;
  const comment = errorLog
    ? `    # Bug found: ${errorLog}`
    : failingTest
      ? `    # Failing check: ${failingTest}`
      : "";

  switch (targetMethod) {
    case "insert":
      return `# Boss Fight: insert attack with seed ${seed}
def test_boss_insert():
${comment}
    al = ${className}()
    seed = ${seed}
    for x in seed:
        al.add(x)

    expected = list(seed)

    # Insert at front
    al.insert(0, -9999)
    expected.insert(0, -9999)
    assert al.size() == len(expected), f"After insert(0), size() is {al.size()}, expected {len(expected)}"
    assert al.get(0) == -9999, f"After insert(0), get(0) returned {al.get(0)}, expected -9999"

    # Insert at middle
    mid = len(expected) // 2
    al.insert(mid, -8888)
    expected.insert(mid, -8888)
    assert al.size() == len(expected), f"After insert({mid}), size() is {al.size()}, expected {len(expected)}"
    assert al.get(mid) == -8888, f"After insert({mid}), get({mid}) returned {al.get(mid)}, expected -8888"

    # Insert at end (index == size, should work like add)
    end = len(expected)
    al.insert(end, -7777)
    expected.insert(end, -7777)
    assert al.size() == len(expected), f"After insert({end}), size() is {al.size()}, expected {len(expected)}"

    # Verify full order
    for i in range(len(expected)):
        assert al.get(i) == expected[i], f"get({i}) returned {al.get(i)}, expected {expected[i]}"

    print("✅ Boss insert test passed!")
`;

    case "remove":
      return `# Boss Fight: remove attack with seed ${seed}
def test_boss_remove():
${comment}
    al = ${className}()
    seed = ${seed}
    for x in seed:
        al.add(x)

    expected = list(seed)

    # Remove at front
    al.remove(0)
    expected.pop(0)
    assert al.size() == len(expected), f"After remove(0), size() is {al.size()}, expected {len(expected)}"
    if len(expected) > 0:
        assert al.get(0) == expected[0], f"After remove(0), get(0) returned {al.get(0)}, expected {expected[0]}"

    # Remove at middle
    if len(expected) >= 2:
        mid = len(expected) // 2
        al.remove(mid)
        expected.pop(mid)
        assert al.size() == len(expected), f"After remove({mid}), size() is {al.size()}, expected {len(expected)}"

    # Remove at last
    if len(expected) >= 1:
        last = len(expected) - 1
        al.remove(last)
        expected.pop(last)
        assert al.size() == len(expected), f"After remove(last), size() is {al.size()}, expected {len(expected)}"

    # Verify remaining order
    for i in range(len(expected)):
        assert al.get(i) == expected[i], f"get({i}) returned {al.get(i)}, expected {expected[i]}"

    print("✅ Boss remove test passed!")
`;

    case "resize":
    case "grow":
    case "add":
      return `# Boss Fight: resize attack with seed ${seed}
def test_boss_resize():
${comment}
    al = ${className}()
    seed = ${seed}
    for x in seed:
        al.add(x)

    assert al.size() == len(seed), f"After adding seed, size() is {al.size()}, expected {len(seed)}"

    # Verify all elements survived
    for i in range(len(seed)):
        assert al.get(i) == seed[i], f"get({i}) returned {al.get(i)}, expected {seed[i]}"

    # Push past capacity boundary
    extra = [seed[-1] if seed else 99] * 5
    for x in extra:
        al.add(x)

    total = len(seed) + len(extra)
    assert al.size() == total, f"After extras, size() is {al.size()}, expected {total}"

    all_vals = seed + extra
    for i in range(total):
        assert al.get(i) == all_vals[i], f"get({i}) returned {al.get(i)}, expected {all_vals[i]}"

    print("✅ Boss resize test passed!")
`;

    default:
      return `# Boss Fight: general attack with seed ${seed}
def test_boss_general():
${comment}
    al = ${className}()
    seed = ${seed}
    expected = []

    # Add all seed values
    for x in seed:
        al.add(x)
        expected.append(x)

    assert al.size() == len(expected), f"After adds, size() is {al.size()}, expected {len(expected)}"

    # Insert at front
    if len(expected) > 0:
        al.insert(0, -9999)
        expected.insert(0, -9999)
        assert al.size() == len(expected), f"After insert, size() is {al.size()}, expected {len(expected)}"
        assert al.get(0) == -9999, f"get(0) returned {al.get(0)}, expected -9999"

    # Remove at front
    if len(expected) > 1:
        al.remove(0)
        expected.pop(0)
        assert al.size() == len(expected), f"After remove, size() is {al.size()}, expected {len(expected)}"

    # Verify order
    for i in range(len(expected)):
        assert al.get(i) == expected[i], f"get({i}) returned {al.get(i)}, expected {expected[i]}"

    print("✅ Boss general test passed!")
`;
  }
}

/**
 * Parse the BOSS_RESULT line from the script's stdout.
 *
 * Returns null if no result line is found.
 */
export function parseBossResult(
  stdout: string
): {
  pass: boolean;
  failingTest?: string;
  expected?: unknown;
  actual?: unknown;
  error?: string;
} | null {
  const lines = stdout.split("\n");
  for (const line of lines) {
    const marker = "BOSS_RESULT:";
    const idx = line.indexOf(marker);
    if (idx !== -1) {
      try {
        return JSON.parse(line.slice(idx + marker.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}
