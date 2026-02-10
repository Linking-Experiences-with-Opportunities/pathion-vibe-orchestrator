/**
 * Challenge Mode / Boss Fight logic for the ArrayList project.
 *
 * Computes a "brittleness score" for each method in the student's code
 * using regex/string heuristics, picks the most brittle method as the
 * boss fight target, and provides a greedy minimization algorithm for
 * shrinking failing seed arrays.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrittlenessScore {
  method: string;
  score: number;
  signals: string[];
}

export interface MinimizationResult {
  inputArray: number[];
  algorithm: "greedy-delete-one";
  timeBudgetMs: number;
  elapsedMs: number;
  stopReason: "len<=3" | "time_budget" | "no_further_reduction";
}

/**
 * Document shape for storing challenge events in MongoDB.
 * Defined here as a TypeScript type for documentation purposes.
 * Do NOT create actual MongoDB collections -- the backend team handles that.
 */
export interface ChallengeEvent {
  userId: string;
  sessionId: string;
  projectId: string;
  createdAt: Date;
  type: "challenge_mode";
  status: "success" | "no_counterexample" | "error";
  original?: {
    inputArray: number[];
    failingTestName?: string;
    expected?: unknown;
    actual?: unknown;
    errorLog?: string;
    model: {
      provider: "gemini";
      model: string;
      reasoningSummary?: string;
    };
  };
  minimized?: {
    inputArray: number[];
    minimization: MinimizationResult;
  };
  ui: {
    headline: string;
    hint: string;
    cta: string;
  };
}

/** Response shape returned by the /api/challenge endpoint. */
export interface ChallengeResponse {
  status: "success" | "no_counterexample" | "error";
  original?: {
    inputArray: number[];
    failingTestName?: string;
    expected?: unknown;
    actual?: unknown;
    errorLog?: string;
    model: {
      provider: "gemini";
      model: string;
      reasoningSummary?: string;
    };
  };
  minimized?: {
    inputArray: number[];
    minimization: MinimizationResult;
  };
  ui: {
    headline: string;
    hint: string;
    cta: string;
  };
}

// ---------------------------------------------------------------------------
// ArrayList method names we look for
// ---------------------------------------------------------------------------

const ARRAYLIST_METHODS = ["add", "insert", "remove", "resize", "grow", "get", "size"] as const;

/**
 * Attempt to extract the body of a Python method from the student code.
 * Returns the lines between `def <methodName>(` and the next `def ` (or EOF).
 */
function extractMethodBody(code: string, methodName: string): string | null {
  // Match def add(, def _add(, def grow(, etc.
  const defPattern = new RegExp(
    `^(\\s*)def\\s+_?${methodName}\\s*\\(`,
    "m"
  );
  const match = defPattern.exec(code);
  if (!match) return null;

  const startIdx = match.index;
  // Find the next top-level `def` after this one (or end of string)
  const rest = code.slice(startIdx + match[0].length);
  const nextDef = rest.search(/^\s*def\s+/m);
  const bodyEnd = nextDef === -1 ? rest.length : nextDef;
  return rest.slice(0, bodyEnd);
}

// ---------------------------------------------------------------------------
// Brittleness scoring
// ---------------------------------------------------------------------------

function scoreMethod(code: string, methodName: string): BrittlenessScore {
  const body = extractMethodBody(code, methodName);
  if (!body) {
    return { method: methodName, score: 0, signals: ["method_not_found"] };
  }

  let score = 0;
  const signals: string[] = [];

  // Loop presence (for/while) -> +3
  if (/\b(for|while)\b/.test(body)) {
    score += 3;
    signals.push("has_loop");
  }

  // Array indexing + assignment (self.data[...] = ...) -> +3
  if (/self\.\w+\[.+\]\s*=/.test(body)) {
    score += 3;
    signals.push("array_index_assign");
  }

  // Touches size or capacity -> +4
  if (/\b(size_|capacity|len\(self\.\w+\)|self\._size|self\.size|self\._capacity|self\.capacity)\b/.test(body)) {
    score += 4;
    signals.push("touches_size_or_capacity");
  }

  // Shifting pattern (loop that writes arr[i+1] or arr[i-1]) -> +5
  if (/\[.+[+-]\s*1\s*\]\s*=/.test(body) || /=\s*.+\[.+[+-]\s*1\s*\]/.test(body)) {
    score += 5;
    signals.push("shifting_pattern");
  }

  // Branchy complexity: +1 per if/elif/else
  const branchCount = (body.match(/\b(if|elif|else)\b/g) || []).length;
  if (branchCount > 0) {
    score += branchCount;
    signals.push(`branches_${branchCount}`);
  }

  // Try/except or manual bounds checks -> +2
  if (/\b(try|except|raise)\b/.test(body)) {
    score += 2;
    signals.push("exception_handling");
  }

  // Has TODO/pass/placeholder -> +10
  if (/\b(TODO|FIXME|HACK)\b/i.test(body) || /^\s*pass\s*$/m.test(body)) {
    score += 10;
    signals.push("placeholder_code");
  }

  return { method: methodName, score, signals };
}

/**
 * Compute brittleness scores for every recognisable ArrayList method.
 * Returns results sorted descending by score.
 */
export function computeBrittlenessScores(code: string): BrittlenessScore[] {
  const scores: BrittlenessScore[] = ARRAYLIST_METHODS.map((m) =>
    scoreMethod(code, m)
  );

  // Merge resize + grow into a single "resize" bucket (take max)
  const resizeIdx = scores.findIndex((s) => s.method === "resize");
  const growIdx = scores.findIndex((s) => s.method === "grow");
  if (resizeIdx !== -1 && growIdx !== -1) {
    if (scores[growIdx].score > scores[resizeIdx].score) {
      scores[resizeIdx] = { ...scores[growIdx], method: "resize" };
    }
    scores.splice(growIdx, 1);
  } else if (growIdx !== -1) {
    scores[growIdx].method = "resize";
  }

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the single most-brittle method to target in the boss fight.
 * Falls back to "resize" if nothing is found.
 */
export function pickTargetMethod(code: string): string {
  const scores = computeBrittlenessScores(code);
  return scores[0]?.method ?? "resize";
}

// ---------------------------------------------------------------------------
// Gemini prompt building
// ---------------------------------------------------------------------------

const BOSS_SCRIPT_DESCRIPTIONS: Record<string, string> = {
  resize:
    "Boss adds all seed values, then adds a few more to force a capacity boundary. " +
    "Checks size(), get(0), and get(size-1) after each phase.",
  insert:
    "Boss adds all seed values, then inserts a sentinel value at index 0, mid, and end. " +
    "Checks element order and size.",
  remove:
    "Boss adds all seed values, then removes elements at index 0, mid, and last. " +
    "Checks remaining order and size.",
  get:
    "Boss adds all seed values, then reads each index including boundary indices 0 and size-1. " +
    "Checks returned values match what was added.",
  size:
    "Boss adds and removes in alternation, checking size() after every operation.",
  add:
    "Boss adds all seed values and checks that get(i) returns seed[i] for every index.",
};

export function buildGeminiPrompt(
  targetMethod: string,
  code: string
): string {
  const bossScriptDescription =
    BOSS_SCRIPT_DESCRIPTIONS[targetMethod] ??
    BOSS_SCRIPT_DESCRIPTIONS["resize"];

  return `You are generating adversarial test inputs for a student's ArrayList implementation.

Goal:
- Produce candidate seed arrays (lists of ints) likely to break the student's implementation under the given Boss Script.
- You MUST return JSON only. No markdown, no code fences, no explanation outside of JSON.

Context:
- Target method likely to be brittle: ${targetMethod}
- Boss Script description: ${bossScriptDescription}
- ArrayList Contract (high level):
  - add(x): appends to end
  - insert(i,x): inserts at index i, shifts right
  - remove(i): removes element at index i, shifts left
  - get(i): returns element at index i
  - size(): number of elements
  - must raise IndexError for invalid indices
  - must preserve order of elements
  - internal array doubles capacity when full (common default capacity: 4 or 8)

Student code:
\`\`\`python
${code}
\`\`\`

Return JSON with this exact shape:

{
  "strategy": "1-2 sentences describing what bug you are trying to trigger",
  "candidate_inputs": [
    { "seedArray": [1, 2, 3, ...], "why": "1 sentence" },
    ...
  ]
}

Constraints:
- Use only integers in seedArray.
- Include at least 3 candidates.
- At least 2 candidates should have length 8-20 to hit resizing boundaries.
- Include at least one candidate with repeated values.
- Include at least one candidate with negative values.
- Include at least one nearly-sorted candidate and one random-ish candidate.
- Think about common ArrayList bugs: off-by-one in resize copy, forgetting to update size after insert/remove, incorrect shifting direction, capacity math errors, boundary behavior at capacity 0/1/power-of-2.`;
}

// ---------------------------------------------------------------------------
// Greedy delete-one minimization
// ---------------------------------------------------------------------------

/**
 * Minimise a failing seed array by greedily removing one element at a time.
 *
 * @param seedArray   The original failing array.
 * @param runTest     A callback that runs the boss test harness and returns
 *                    whether it passes and optionally which test failed.
 * @param timeBudgetMs Maximum wall-clock time to spend minimising (default 5 s).
 */
export async function minimizeSeedArray(
  seedArray: number[],
  runTest: (arr: number[]) => Promise<{ pass: boolean; failingTest?: string }>,
  timeBudgetMs: number = 5000
): Promise<MinimizationResult> {
  const start = Date.now();
  let best = [...seedArray];

  const elapsed = () => Date.now() - start;

  while (best.length >= 0 && elapsed() < timeBudgetMs) {
    let improved = false;

    for (let i = 0; i < best.length; i++) {
      if (elapsed() >= timeBudgetMs) {
        return {
          inputArray: best,
          algorithm: "greedy-delete-one",
          timeBudgetMs,
          elapsedMs: elapsed(),
          stopReason: "time_budget",
        };
      }

      // Try removing element at index i
      const trial = [...best.slice(0, i), ...best.slice(i + 1)];
      const result = await runTest(trial);

      if (!result.pass) {
        // Still fails -- shrink and restart inner loop
        best = trial;
        improved = true;
        break;
      }
    }

    if (!improved) {
      return {
        inputArray: best,
        algorithm: "greedy-delete-one",
        timeBudgetMs,
        elapsedMs: elapsed(),
        stopReason: "no_further_reduction",
      };
    }
  }

  const stopReason: MinimizationResult["stopReason"] =
    best.length <= 3 ? "len<=3" : "time_budget";

  return {
    inputArray: best,
    algorithm: "greedy-delete-one",
    timeBudgetMs,
    elapsedMs: elapsed(),
    stopReason,
  };
}
