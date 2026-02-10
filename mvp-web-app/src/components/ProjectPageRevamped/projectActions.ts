import { TestResult } from "../ProblemPageRevamped/models";
import { ProjectData } from "../CodeEditor/types";
import { parseUnittestFile } from "./projectTestRunner";
import { runCode } from "@/lib/codeRunner";
import { RunResponse } from "@/lib/runner-contract";
import { generateUnittestRunnerCode } from "@/lib/unittestRunnerTemplate";
import { submitSubmission } from "@/lib/submissionClient";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { trackTelemetry } from "@/lib/telemetryClient";
import { EditorSignals } from "@/lib/editorSignals";
import {
    emitCodeRunEvent,
    emitWarmupSubmittedEvent,
    emitActivatedEvent,
    isWarmupProject
} from "@/lib/onboardingEvents";
import { invalidateProjectsCacheAfterSubmission } from "@/lib/cacheApiForOffline";
import { emitProjectProgressUpdate } from "@/lib/projectProgressEvents";
import { mapPythonError, UniversalErrorCode, getErrorTooltip } from "@/lib/errorCodeMapper";
import { parseVizPayloadFromStdout } from "@/lib/vizPayloadParser";
import { isEligibleForViz } from "@/lib/vizEligibility";
import { VizPayloadV1, VizDiagramType } from "@/lib/vizPayload";

/**
 * Result of running project test cases, including stdout/stderr and user tests
 */
export interface ProjectTestRunResult {
    testResults: TestResult[];
    stdout: string;
    stderr: string;
    /** Whether all official tests passed */
    passed: boolean;
    /** Total run duration in milliseconds */
    durationMs?: number;
    /** Time to first result (ms); may be set when running in browser */
    ttfrMs?: number;
    userTestsResults?: any[];
    /** Visualization payload for debugging (if eligible) */
    vizPayload?: VizPayloadV1;
    /** Clean user print() output (test framework markers stripped from stdout) */
    consoleOutput: string;
}

/**
 * Extract clean user print() output from raw stdout by stripping test framework markers.
 * Removes: TEST_RESULTS_JSON blocks and PASS/FAIL/ERROR summary lines from the test harness.
 */
function extractUserPrintOutput(stdout: string): string {
    let clean = stdout;

    // 1. Strip TEST_RESULTS_JSON block(s)
    const startMarker = '=== TEST_RESULTS_JSON_START ===';
    const endMarker = '=== TEST_RESULTS_JSON_END ===';
    while (true) {
        const s = clean.indexOf(startMarker);
        if (s === -1) break;
        const e = clean.indexOf(endMarker, s);
        if (e === -1) break;
        let blockStart = s;
        if (blockStart > 0 && clean[blockStart - 1] === '\n') blockStart--;
        let blockEnd = e + endMarker.length;
        if (blockEnd < clean.length && clean[blockEnd] === '\n') blockEnd++;
        clean = clean.substring(0, blockStart) + clean.substring(blockEnd);
    }

    // 2. Strip test harness summary lines (PASS: test_xxx, FAIL: test_xxx, ERROR: test_xxx)
    //    and their indented continuation lines (error details, tracebacks)
    const lines = clean.split('\n');
    const filtered: string[] = [];
    let inTestOutput = false;
    for (const line of lines) {
        if (/^(PASS|FAIL|ERROR): \S/.test(line)) {
            inTestOutput = true;
            continue;
        }
        if (inTestOutput) {
            // Skip indented continuations and traceback lines that follow FAIL/ERROR
            if (line === '' || /^\s/.test(line) || line.startsWith('Traceback')) {
                continue;
            }
            inTestOutput = false;
        }
        filtered.push(line);
    }

    return filtered.join('\n').trim();
}

/**
 * Runs individual or all project test cases
 * @param projectData - The project data
 * @param files - All project files including user code
 * @param testCaseNumber - Which test to run (0-indexed, -1 for all)
 * @param runAllCases - Whether to run all tests
 * @param shouldSubmit - Whether to submit results to backend
 * @param userTestsCode - Optional user-written test code to execute alongside official tests
 * @param editorSignals - Optional editor signals for copy/paste tracking
 */
export async function runProjectTestCases(
    projectData: ProjectData,
    files: Record<string, string>,
    testCaseNumber: number,
    runAllCases: boolean,
    shouldSubmit: boolean = false,
    userTestsCode: string = "",
    editorSignals?: EditorSignals
): Promise<ProjectTestRunResult> {
    try {
        // Track telemetry for run/submit attempts
        // NOTE: projectNumber is critical for funnel metrics (warmupRun, enteredCurriculum)
        if (shouldSubmit) {
            await trackTelemetry('project_submit_attempt', {
                projectId: projectData.id,
                projectNumber: projectData.projectNumber,
                projectTitle: projectData.title,
                runAllCases,
                testCaseNumber: runAllCases ? -1 : testCaseNumber
            });
        } else {
            await trackTelemetry('project_run_attempt', {
                projectId: projectData.id,
                projectNumber: projectData.projectNumber,
                projectTitle: projectData.title,
                runAllCases,
                testCaseNumber: runAllCases ? -1 : testCaseNumber
            });
        }
        // Get test names from test file
        const { testNames, className, error } = parseUnittestFile(projectData.testFile.content);

        if (error) {
            throw new Error(error);
        }

        if (testNames.length === 0) {
            throw new Error("No test methods found in test file");
        }

        // Build complete Python code with all files
        let pythonCode = "";

        // Detect which modules are imported and need registration
        const importedModules = detectImportedModules(files);

        // Sort files so that imported modules come first (before files that import them)
        const sortedFiles = Object.entries(files).sort(([filenameA], [filenameB]) => {
            const moduleA = filenameA.replace(/\.py$/, '');
            const moduleB = filenameB.replace(/\.py$/, '');
            const aIsImported = importedModules.has(moduleA);
            const bIsImported = importedModules.has(moduleB);
            // Imported modules should come first
            if (aIsImported && !bIsImported) return -1;
            if (!aIsImported && bIsImported) return 1;
            return 0;
        });

        // Add all files (including test file) with module registration
        for (const [filename, content] of sortedFiles) {
            let fileContent = content;

            // Strip __future__ imports to avoid policy violations
            fileContent = stripFutureImports(fileContent);

            // Add module registration if this file is imported by others
            const moduleName = filename.replace(/\.py$/, '');
            if (importedModules.has(moduleName)) {
                fileContent = addModuleRegistration(fileContent, moduleName);
            }

            pythonCode += `# === ${filename} ===\n${fileContent}\n\n`;
        }

        // Determine which tests to run
        const testsToRun = runAllCases || testCaseNumber === -1
            ? testNames
            : testCaseNumber >= 0 && testCaseNumber < testNames.length
                ? [testNames[testCaseNumber]]
                : [];

        if (testsToRun.length === 0) {
            throw new Error("No valid test selected");
        }

        // Build unittest runner
        const testRunnerCode = generateUnittestRunnerCode(testsToRun, className);

        // Append user tests code if provided
        if (userTestsCode && userTestsCode.trim()) {
            pythonCode += `\n# === USER TESTS ===\n${userTestsCode}\n\n`;
        }

        // Logging for debugging
        console.log("[runner] testsToRun:", testsToRun);
        console.log("[runner] className:", className);
        console.log("[runner] importedModules:", Array.from(importedModules));
        console.log("[runner] hasUserTests:", !!userTestsCode);

        const fullCode = pythonCode + testRunnerCode;

        // Ensure testCases array is non-empty
        // expected: 0 ensures worker detects failure (__run_unittest__ returns 1 on fail)
        const testCases = [{ id: "unittest", fn: "__run_unittest__", expected: 0 }];
        if (testCases.length === 0) {
            throw new Error("testCases array cannot be empty");
        }

        // Run using Pyodide
        const runResult = await runCode(
            fullCode,
            testCases,
            {
                timeoutMs: projectData.limits?.timeoutMs || 10000,
                memLimitMB: projectData.limits?.memoryMB || 256,
                problemId: projectData.id
            }
        );


        // Parse test results from output or use structured summary
        const output = runResult.stdout + '\n' + runResult.stderr;
        let testResults: TestResult[] = [];

        // For project unittest runner, individual results are embedded in stdout
        // as TEST_RESULTS_JSON. The worker's testSummary only has the single
        // __run_unittest__ wrapper result (1 entry), so prefer stdout parsing.
        const isUnittestWrapper = runResult.testSummary?.cases?.length === 1
            && runResult.testSummary.cases[0]?.fn === '__run_unittest__';

        if (isUnittestWrapper) {
            // Parse individual test results from stdout JSON block
            testResults = parseTestOutput(output, testsToRun);
        } else if (runResult.testSummary && runResult.testSummary.cases.length > 0) {
            testResults = runResult.testSummary.cases.map(t => ({
                name: t.fn.replace('test_', '').replace(/_/g, ' '),
                expected: "Pass",
                actual: t.passed ? "Pass" : "Fail",
                passed: t.passed,
                printed: t.error || (t.passed ? "Test passed" : output),
                consoleOutput: "",
                errorCode: t.errorCode as UniversalErrorCode,
                errorTooltip: getErrorTooltip(t.errorCode as UniversalErrorCode)
            }));
        } else {
            testResults = parseTestOutput(output, testsToRun);
        }

        // Extract user tests results from meta
        const userTestsResults = runResult.meta?.userTests || [];

        // --- Visualization Logic ---
        let vizPayload: VizPayloadV1 | undefined;
        let vizDiagnostics: Record<string, unknown> = {};

        try {
            const runResultViz = runResult.viz ?? null;
            const hasVizMarkersInOutput = output.includes("=== VIZ_PAYLOAD_START ===") && output.includes("=== VIZ_PAYLOAD_END ===");
            const parsedFromStdout = parseVizPayloadFromStdout(output);
            const rawViz = runResultViz ?? parsedFromStdout;

            vizDiagnostics = {
                hasRunResultViz: !!runResultViz,
                hasVizMarkersInOutput,
                parsedFromStdout: !!parsedFromStdout,
                rawViz: rawViz ? { diagramType: rawViz.diagramType } : null,
                failingTestCount: testResults.filter(t => !t.passed).length,
                totalTests: testResults.length,
            };

            if (rawViz) {
                const failingTest = testResults.find(t => !t.passed);
                const structureDetected = !!rawViz;
                const testName = failingTest?.name ?? "structure_detected";
                const errorCode = failingTest?.errorCode ?? "TEST_FAILED";
                const eligible = isEligibleForViz(testName, errorCode, 0, structureDetected);

                vizDiagnostics.vizEligible = eligible;
                vizDiagnostics.testName = testName;
                vizDiagnostics.errorCode = errorCode;

                if (failingTest || structureDetected) {
                    if (eligible) {
                        vizPayload = {
                            version: "1",
                            testName,
                            errorCode,
                            vizEligible: true,
                            viz: {
                                diagramType: rawViz.diagramType as VizDiagramType,
                                structure: rawViz.structure as any,
                                markers: (rawViz.markers || {}) as any,
                                stateSnapshot: rawViz.stateSnapshot as any,
                                truncated: rawViz.truncated,
                            }
                        };
                    } else {
                        vizDiagnostics.reason = "isEligibleForViz returned false";
                    }
                } else {
                    vizDiagnostics.reason = "no failing test and structureDetected false";
                }
            } else {
                vizDiagnostics.reason = !runResultViz && !parsedFromStdout
                    ? (hasVizMarkersInOutput
                        ? "viz markers in output but parse failed (check JSON shape)"
                        : "no viz from worker and no VIZ_PAYLOAD markers in stdout (dump_viz not called or no structures found)")
                    : "rawViz null";
            }

            vizDiagnostics.vizPayload = vizPayload ? { testName: vizPayload.testName } : null;
        } catch (vizErr: any) {
            vizDiagnostics.error = vizErr?.message ?? String(vizErr);
            vizDiagnostics.reason = "viz pipeline threw";
        }

        console.log("[projectActions] viz pipeline:", vizDiagnostics);
        // ---------------------------

        // Emit onboarding event for code run (Step 2)
        emitCodeRunEvent();

        // If shouldSubmit is true, submit to backend
        if (shouldSubmit) {
            try {
                // Get authenticated user
                const supabase = createClientComponentClient();
                const { data: { session } } = await supabase.auth.getSession();

                if (session?.user) {
                    // IMPORTANT: Always use Supabase UUID as userId, NOT email
                    // The email is sent separately in the submission payload
                    // See RCA: docs/RCA_METRICS_AND_USERS_BUG.md for details
                    const userId = session.user.id;

                    // Convert testResults to testSummary format
                    const testSummary = {
                        total: testResults.length,
                        passed: testResults.filter(t => t.passed).length,
                        failed: testResults.filter(t => !t.passed).length,
                        cases: testResults.map(t => ({
                            fn: t.name,
                            passed: t.passed,
                            expected: t.expected,
                            received: t.actual,
                            durationMs: 0, // Duration per test not available in current format
                            error: t.passed ? undefined : t.printed
                        }))
                    };

                    // Build RunResponse with test summary
                    const runResultWithSummary: RunResponse = {
                        ...runResult,
                        testSummary
                    };

                    // Extract user tests results from meta
                    const extractedUserTestsResults = runResult.meta?.userTests || [];

                    // Submit to backend with both userId (UUID) and email
                    const submissionResult = await submitSubmission(
                        projectData.id,
                        userId,
                        "", // code not used for projects
                        runResultWithSummary,
                        "project",
                        files,
                        userTestsCode,
                        extractedUserTestsResults,
                        editorSignals,
                        session.user.email, // Pass email separately
                        vizPayload // Pass viz entry for debug
                    );

                    if (submissionResult.success) {
                        console.log('✅ Project submission successful:', submissionResult.submissionId);

                        // Calculate progress for optimistic UI update
                        const submissionPassedCount = testResults.filter(t => t.passed).length;
                        const submissionTotalCount = testResults.length;
                        const submissionAllPassed = submissionPassedCount === submissionTotalCount && submissionTotalCount > 0;
                        console.log("[progress] about to emit optimistic update", {
                            projectId: projectData.id,
                            passedTests: submissionPassedCount,
                            totalTests: submissionTotalCount,
                            isCompleted: submissionAllPassed,
                        });


                        // Emit optimistic progress update for cross-component UI updates
                        // This allows /projects page to update immediately without network round-trip
                        emitProjectProgressUpdate({
                            projectId: projectData.id,
                            passedTests: submissionPassedCount,
                            totalTests: submissionTotalCount,
                            isCompleted: submissionAllPassed,
                        });

                        // Store progress in localStorage for persistence across tabs/refreshes
                        // This ensures /projects page ALWAYS shows correct progress,
                        // even if API returns stale data. Cleaned up when API catches up.
                        try {
                            const LOCAL_PROGRESS_KEY = 'projectProgressCache';
                            const existingRaw = localStorage.getItem(LOCAL_PROGRESS_KEY);
                            const existing = existingRaw ? JSON.parse(existingRaw) : {};
                            const currentEntry = existing[projectData.id];

                            // Only save if it represents forward progress
                            const shouldSave = !currentEntry ||
                                submissionPassedCount > currentEntry.passedTests ||
                                (submissionAllPassed && !currentEntry.isCompleted);

                            if (shouldSave) {
                                existing[projectData.id] = {
                                    passedTests: submissionPassedCount,
                                    totalTests: submissionTotalCount,
                                    isCompleted: submissionAllPassed,
                                    timestamp: Date.now(),
                                };
                                localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(existing));
                                console.log('[progress] Saved to localStorage:', projectData.id, existing[projectData.id]);
                            }
                        } catch (storageError) {
                            // Non-blocking - localStorage may be unavailable in some contexts
                            console.warn('[progress] Failed to write to localStorage:', storageError);
                        }

                        // Invalidate projects cache so /projects overview shows fresh progress
                        // This clears stale "Not Started" data from cached API responses
                        try {
                            await invalidateProjectsCacheAfterSubmission();
                        } catch (cacheError) {
                            // Non-blocking - cache invalidation failure shouldn't break submission flow
                            console.warn('[Cache] Failed to invalidate projects cache:', cacheError);
                        }

                        // Emit appropriate onboarding event based on project type
                        // IMPORTANT: Warmup (Project Zero) does NOT count as activation!
                        if (isWarmupProject(projectData.projectNumber)) {
                            // Project Zero = warmup submission (NOT activation)
                            emitWarmupSubmittedEvent(projectData.id, projectData.projectNumber);
                            console.log('📝 Warmup submission recorded (Project Zero)');
                        } else {
                            // Real project (projectNumber >= 1) = TRUE activation
                            emitActivatedEvent(projectData.id, projectData.projectNumber);
                            console.log('🎉 User ACTIVATED (first real project submission)');

                            // Track activation telemetry for funnel metrics
                            await trackTelemetry('user_activated', {
                                projectId: projectData.id,
                                projectNumber: projectData.projectNumber,
                                projectTitle: projectData.title,
                            });
                        }

                        // Track successful submission with test results
                        const allPassed = testResults.every(t => t.passed);
                        await trackTelemetry('project_submission_result', {
                            projectId: projectData.id,
                            projectTitle: projectData.title,
                            allTestsPassed: allPassed,
                            passedCount: testResults.filter(t => t.passed).length,
                            totalTests: testResults.length,
                            failedTests: testResults
                                .filter(t => !t.passed)
                                .map(t => ({
                                    testName: t.name,
                                    error: t.printed
                                }))
                        });
                    } else {
                        console.error('❌ Project submission failed:', submissionResult.error);
                    }
                } else {
                    console.warn('User not authenticated, skipping submission');
                }
            } catch (error) {
                console.error('Error submitting project:', error);
            }
        }

        return {
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            passed: testResults.every(t => t.passed),
            durationMs: runResult.durationMs ?? 0,
            ttfrMs: runResult.ttfrMs,
            testResults: testResults,
            userTestsResults: userTestsResults,
            vizPayload: vizPayload,
            consoleOutput: extractUserPrintOutput(runResult.stdout || ""),
        };

    } catch (error: any) {
        console.error('Error running project tests:', error);
        const errorMessage = error.message || "Test execution failed";

        // Map to universal error code
        const errorInfo = mapPythonError('error', errorMessage, errorMessage);

        return {
            testResults: [{
                name: runAllCases ? "All Tests" : `Test ${testCaseNumber + 1}`,
                expected: "Pass",
                actual: "Error",
                passed: false,
                printed: errorMessage,
                errorCode: errorInfo.code,
                errorTooltip: errorInfo.tooltip
            }],
            stdout: "",
            stderr: errorMessage,
            passed: false,
            consoleOutput: "",
        };
    }
}

/**
 * Parse test output to extract individual test results
 */
function parseTestOutput(output: string, testNames: string[]): TestResult[] {
    const testResults: TestResult[] = [];

    // Try to extract JSON results
    let testData = null;
    const startIdx = output.indexOf('=== TEST_RESULTS_JSON_START ===');
    const endIdx = output.indexOf('=== TEST_RESULTS_JSON_END ===');

    if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = output.substring(startIdx + 32, endIdx).trim();
        try {
            testData = JSON.parse(jsonStr);
        } catch (e) {
            console.warn('Failed to parse test results JSON:', e);
        }
    }

    if (testData?.results) {
        // Use parsed JSON results
        for (const result of testData.results) {
            // Map to universal error code
            const errorInfo = mapPythonError(
                result.status as 'pass' | 'fail' | 'error',
                result.message,
                output
            );

            testResults.push({
                name: result.name.replace('test_', '').replace(/_/g, ' '),
                expected: "Pass",
                actual: result.status === 'pass' ? "Pass" : result.status === 'error' ? "Error" : "Fail",
                passed: result.status === 'pass',
                printed: result.message || (result.status === 'pass' ? "Test passed" : output),
                consoleOutput: result.output || "",
                errorCode: errorInfo.code,
                errorTooltip: errorInfo.tooltip
            });
        }
    } else {
        // Fallback: parse output manually
        const allPassed = output.includes('OK') && !output.includes('FAILED');

        for (const testName of testNames) {
            const testFailed = output.includes(`FAIL: ${testName}`) || output.includes(`ERROR: ${testName}`);
            const isError = output.includes(`ERROR: ${testName}`);
            const passed = allPassed && !testFailed;

            let errorMsg = "";
            if (testFailed) {
                const failMatch = output.match(new RegExp(`(?:FAIL|ERROR): ${testName}.*?\\n([\\s\\S]*?)(?=\\n(?:FAIL|ERROR|===|OK)|$)`));
                if (failMatch) {
                    errorMsg = failMatch[1].trim();
                }
            }

            // Map to universal error code
            const status: 'pass' | 'fail' | 'error' = passed ? 'pass' : isError ? 'error' : 'fail';
            const errorInfo = mapPythonError(status, errorMsg, output);

            testResults.push({
                name: testName.replace('test_', '').replace(/_/g, ' '),
                expected: "Pass",
                actual: passed ? "Pass" : "Fail",
                passed: passed,
                printed: errorMsg || (passed ? "Test passed" : output),
                consoleOutput: "",  // Fallback parser can't extract per-test output
                errorCode: errorInfo.code,
                errorTooltip: errorInfo.tooltip
            });
        }
    }

    return testResults;
}

/**
 * Get display names for all test cases in a project
 */
export function getProjectTestCaseNames(projectData: ProjectData): string[] {
    const { testNames } = parseUnittestFile(projectData.testFile.content);
    return testNames.map(name => name.replace('test_', '').replace(/_/g, ' '));
}

/**
 * Detect which modules are imported from other files in the project
 */
function detectImportedModules(files: Record<string, string>): Set<string> {
    const importedModules = new Set<string>();
    const moduleNames = Object.keys(files).map(f => f.replace(/\.py$/, ''));

    // Check all files for import statements
    for (const content of Object.values(files)) {
        // Match: from module_name import ...
        const fromImportRegex = /from\s+([a-zA-Z0-9_]+)\s+import/g;
        let match;
        while ((match = fromImportRegex.exec(content)) !== null) {
            const moduleName = match[1];
            // Only track if it's a project file (not stdlib)
            if (moduleNames.includes(moduleName)) {
                importedModules.add(moduleName);
            }
        }

        // Match: import module_name (standalone import)
        const importRegex = /^import\s+([a-zA-Z0-9_]+)\s*(?:#.*)?$/gm;
        while ((match = importRegex.exec(content)) !== null) {
            const moduleName = match[1];
            // Only track if it's a project file (not stdlib)
            if (moduleNames.includes(moduleName)) {
                importedModules.add(moduleName);
            }
        }
    }

    return importedModules;
}

/**
 * Strip __future__ imports to avoid policy violations
 */
function stripFutureImports(content: string): string {
    // Remove lines like: from __future__ import ...
    return content.split('\n')
        .filter(line => !line.trim().startsWith('from __future__ import'))
        .join('\n');
}

/**
 * Add synthetic module registration code to a file
 * This allows "from module_name import Class" to work in Pyodide
 */
function addModuleRegistration(content: string, moduleName: string): string {
    // Extract class and function names from the file
    const classRegex = /^class\s+(\w+)/gm;
    const functionRegex = /^def\s+(\w+)/gm;

    const classes: string[] = [];
    const functions: string[] = [];

    let match;
    while ((match = classRegex.exec(content)) !== null) {
        classes.push(match[1]);
    }

    while ((match = functionRegex.exec(content)) !== null) {
        functions.push(match[1]);
    }

    // Build module registration code
    const registrationCode = `
# === Module Registration (for Pyodide imports) ===
import sys
import types
_mod = types.ModuleType("${moduleName}")
${classes.map(cls => `_mod.${cls} = ${cls}`).join('\n')}
${functions.map(fn => `_mod.${fn} = ${fn}`).join('\n')}
sys.modules["${moduleName}"] = _mod
`;

    // Append registration code to the file
    return content + registrationCode;
}
