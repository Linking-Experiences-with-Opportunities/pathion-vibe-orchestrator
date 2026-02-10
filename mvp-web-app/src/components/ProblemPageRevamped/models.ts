enum CodeSubmissionStatus {
    PASSED = "passed",
    FAILED = "failed"
}

export interface SubmissionTestCaseResult {
    case: number
    status: CodeSubmissionStatus
    message: string
}

export interface Submission {
    ID: string
    UserId: string
    SourceCode: string
    LanguageID: number
    QuestionNumber: number
    QuestionsCorrect: number
    Result: SubmissionTestCaseResult[]
    HasSolvedProblem: boolean
    CreatedAt: string
}

import { UniversalErrorCode } from "@/lib/errorCodeMapper";

export interface TestResult {
    name: string;
    expected: any;
    actual: any;
    passed: boolean;
    printed: string;
    /** Per-test captured print() output (from io.StringIO redirect in test runner) */
    consoleOutput?: string;
    /** Universal error code for categorizing the failure type */
    errorCode?: UniversalErrorCode;
    /** User-friendly tooltip explaining the error category */
    errorTooltip?: string;
    /** Visualization payload captured during execution */
    vizPayload?: any; // typed as any to avoid circular dependencies, but logically VizPayloadV1
}
