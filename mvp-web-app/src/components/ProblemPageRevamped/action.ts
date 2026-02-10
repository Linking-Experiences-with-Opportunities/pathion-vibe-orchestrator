import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { TestResult } from "./models";
import { runCode, convertToTestResults } from "@/lib/codeRunner";
import { TestCase } from "@/lib/runner-contract";
import { submitSubmission } from "@/lib/submissionClient";
import { QuestionData } from "@/components/CodeEditor/types";
import { getApiUrl } from "@/lib/apiConfig";
import { EditorSignals } from "@/lib/editorSignals";

/** Result from running problem/module test cases */
export interface TestRunResult {
    testResults: TestResult[];
    /** Clean user print() output (stdout with test framework noise stripped) */
    consoleOutput: string;
}

interface RunTestCasePayload {
    sourceCode: string
    languageID: number
    testCaseNumber: number
    runAllCases: boolean
}

interface ModuleRunTestCasePayload {
    sourceCode: string
    languageID: number
    testCaseNumber: number
    runAllCases: boolean
    contentIndex: number
}

// Design (class-sequence) problems use input like: "["Op1","op2",...], [[arg1],[arg2],...]"
// which is two JSON values. Parse that format when single JSON.parse fails.
function parseTestInput(inputStr: string, className?: string): unknown {
    const trimmed = (inputStr ?? "").trim();
    if (!trimmed) return [];

    try {
        return JSON.parse(trimmed);
    } catch {
        // Design harness format: "operationsArray, argumentsArray" (two JSON values)
        if (className) {
            try {
                const asArray = JSON.parse("[" + trimmed + "]");
                if (Array.isArray(asArray) && asArray.length === 2 &&
                    Array.isArray(asArray[0]) && Array.isArray(asArray[1])) {
                    return asArray;
                }
            } catch {
                // fall through to throw
            }
        }
        throw new Error(`Invalid JSON in test input: "${trimmed.slice(0, 80)}${trimmed.length > 80 ? "…" : ""}"`);
    }
}

function parseExpectedOutput(outputStr: string): unknown {
    const trimmed = (outputStr ?? "").trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        throw new Error(`Invalid JSON in expected output: "${outputStr?.slice(0, 80)}${(outputStr?.length ?? 0) > 80 ? "…" : ""}"`);
    }
}

// Convert problem test cases to runner format
function convertToRunnerTestCases(
    problemData: QuestionData,
    testCaseNumber?: number,
    runAll: boolean = false
): TestCase[] {
    // Defensive guard: ensure testCases is an array
    const testCases = Array.isArray(problemData.testcases) ? problemData.testcases : [];
    if (!Array.isArray(problemData.testcases)) {
        console.error('Expected testcases array from backend. Got:', problemData.testcases);
        console.error('Expected problem data from backend. Got:', problemData);

    }

    const functionName = problemData.functionName || (problemData as { methodName?: string }).methodName || 'solve';
    const className = problemData.className;

    // Validate function name (allow empty for design-only problems where fn is __design__)
    const isDesignHarness = Boolean(className && testCases.length > 0 && (() => {
        const tc = testCases[0];
        try {
            const parsed = parseTestInput(tc.input, className);
            return Array.isArray(parsed) && parsed.length === 2 && Array.isArray(parsed[0]) && Array.isArray(parsed[1]);
        } catch {
            return false;
        }
    })());
    const effectiveFn = isDesignHarness ? "__design__" : (functionName || "solve");
    if (!effectiveFn || (effectiveFn !== "__design__" && effectiveFn.trim() === "")) {
        console.error('[BUG] Empty functionName in problem data!', problemData);
        throw new Error('Question missing function name - cannot run tests. Please report this bug.');
    }

    if (!runAll && testCaseNumber !== undefined && testCaseNumber >= 0) {
        const tc = testCases[testCaseNumber];
        if (!tc) return [];

        try {
            const args = parseTestInput(tc.input, className) as any;
            const expected = parseExpectedOutput(tc.expected_output);
            return [{
                id: `test_${testCaseNumber}`,
                fn: Array.isArray(args) && args.length === 2 && Array.isArray(args[0]) && Array.isArray(args[1]) ? "__design__" : effectiveFn,
                className: className ?? undefined,
                args: Array.isArray(args) ? args : [args],
                expected,
            }];
        } catch (parseError) {
            console.error('[BUG] Invalid test case in test', testCaseNumber, ':', tc);
            throw new Error(`Test case ${testCaseNumber} has invalid JSON format. Input: "${tc.input}", Expected: "${tc.expected_output}"`);
        }
    }

    return testCases.map((tc, index) => {
        try {
            const args = parseTestInput(tc.input, className) as any;
            const expected = parseExpectedOutput(tc.expected_output);
            const isDesign = Array.isArray(args) && args.length === 2 && Array.isArray(args[0]) && Array.isArray(args[1]);
            return {
                id: `test_${index}`,
                fn: isDesign ? "__design__" : effectiveFn,
                className: className ?? undefined,
                args: Array.isArray(args) ? args : [args],
                expected,
            };
        } catch (parseError) {
            console.error('[BUG] Invalid test case in test', index, ':', tc);
            throw new Error(`Test case ${index} has invalid JSON format. Input: "${tc.input}", Expected: "${tc.expected_output}"`);
        }
    });
}

// Fetch problem data for runner
async function fetchProblemDataForRunner(problemNumber: string): Promise<QuestionData | null> {
    try {
        const url = getApiUrl(`/question/${problemNumber}`);
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch problem data:', error);
        return null;
    }
}

export const runTestCases = async (
    problemNumber: string,
    sourceCode: string,
    languageID: number,
    testCaseNumber: number,
    runAllCases: boolean,
    shouldSubmit: boolean = false,  // NEW: flag to control submission
    editorSignals?: EditorSignals,  // Editor signals for copy/paste tracking
): Promise<TestRunResult> => {
    try {
        // Fetch problem data to get test cases and function name
        const problemData = await fetchProblemDataForRunner(problemNumber);
        if (!problemData) {
            throw new Error("Failed to fetch problem data");
        }

        // Validate that testcases exists and is an array
        if (!problemData.testcases || !Array.isArray(problemData.testcases)) {
            console.error('Problem data missing valid testcases array:', problemData);
            throw new Error("Problem data is missing test cases. This problem may not be configured correctly.");
        }

        // Convert test cases to runner format
        const testCases = convertToRunnerTestCases(problemData, testCaseNumber, runAllCases);

        // Run code using Pyodide
        const runResult = await runCode(sourceCode, testCases, {
            timeoutMs: 5000,
            memLimitMB: 128,
            problemId: problemNumber
        });

        // Only submit to backend if shouldSubmit is true (Submit button)
        if (shouldSubmit) {
            const userId = (window as any).__userId || "anonymous";
            submitSubmission(
                problemNumber,
                userId,
                sourceCode,
                runResult,
                "code",
                undefined, // files
                undefined, // userTestsCode
                undefined, // userTestsResults
                editorSignals // pass editor signals
            ).catch(err => {
                console.warn("Failed to submit result:", err);
            });
        }

        // Convert to TestResult format
        return {
            testResults: convertToTestResults(runResult),
            consoleOutput: runResult.stdout || "",
        };
    } catch (error: any) {
        console.error('Error running test cases:', error);

        // Return error as failed test result
        return {
            testResults: [{
                name: runAllCases ? "All Tests" : `Test ${testCaseNumber + 1}`,
                expected: null,
                actual: null,
                passed: false,
                printed: error.message || "Execution failed"
            }],
            consoleOutput: "",
        };
    }
};

// Fetch module data for runner
async function fetchModuleDataForRunner(moduleId: string): Promise<any | null> {
    try {
        const url = getApiUrl(`/modules/${moduleId}`);
        const response = await fetchWithAuth(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch module data:', error);
        return null;
    }
}

export const runModuleTestCases = async (
    moduleId: string,
    sourceCode: string,
    languageID: number,
    testCaseNumber: number,
    runAllCases: boolean,
    contentIndex: number,
    shouldSubmit: boolean = false,  // NEW: flag to control submission
    editorSignals?: EditorSignals,  // Editor signals for copy/paste tracking
): Promise<TestRunResult> => {
    try {
        // Fetch module data to get problem details
        const moduleData = await fetchModuleDataForRunner(moduleId);
        if (!moduleData || !moduleData.content?.[contentIndex]?.data) {
            throw new Error("Failed to fetch module data");
        }

        const problemData = moduleData.content[contentIndex].data;

        // Validate that testcases exists and is an array
        if (!problemData.testcases || !Array.isArray(problemData.testcases)) {
            console.error('Module problem data missing valid testcases array:', problemData);
            throw new Error("Module problem data is missing test cases. This problem may not be configured correctly.");
        }

        // Convert test cases to runner format
        const testCases = convertToRunnerTestCases(problemData, testCaseNumber, runAllCases);

        // Run code using Pyodide
        const runResult = await runCode(sourceCode, testCases, {
            timeoutMs: 5000,
            memLimitMB: 128,
            problemId: `module_${moduleId}_${contentIndex}`
        });



        // Only submit to backend if shouldSubmit is true (Submit button)
        if (shouldSubmit) {
            const userId = (window as any).__userId || "anonymous";
            submitSubmission(
                `module_${moduleId}_${contentIndex}`,
                userId,
                sourceCode,
                runResult,
                "code",
                undefined, // files
                undefined, // userTestsCode
                undefined, // userTestsResults
                editorSignals // pass editor signals
            ).catch(err => {
                console.warn("Failed to submit module result:", err);
            });
        }

        // Convert to TestResult format
        return {
            testResults: convertToTestResults(runResult),
            consoleOutput: runResult.stdout || "",
        };
    } catch (error: any) {
        console.error('Error running module test cases:', error);

        // Return error as failed test result
        return {
            testResults: [{
                name: runAllCases ? "All Tests" : `Test ${testCaseNumber + 1}`,
                expected: null,
                actual: null,
                passed: false,
                printed: error.message || "Execution failed"
            }],
            consoleOutput: "",
        };
    }
};
