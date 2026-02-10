

export interface QuestionData {
    _id: string;
    questionNumber: number
    title: string
    description: string
    difficulty: string
    functionName?: string
    className?: string
    codeSnippet?: string
    dislikes?: number
    dikes?: number // (P.S. You probably meant 'likes' here)
    testcases?: TestCase[]
    createdAt?: string
    updatedAt?: string 
}
export interface TestCase {
    ID: number;
    Name: string;
    QuestionNumber: number;
    input: string;
    expected_output: string;
    CreatedAt: string; // ISO 8601 timestamp format
    UpdatedAt: string; // ISO 8601 timestamp format
};

export interface ProblemSubmissionResponse {
    ID: string,
    Uuid?: string
    "SourceCode": string
    "LanguageID": number
    "QuestionID": number
    "Token": string
    "Stdout": string
    "Stderr": string
    "Statusid": number
    "Statusdescription": string
}

export interface ModuleProblemSubmissionResponse {
    submissionId: string
    passedAllTestCases: boolean
}

export interface ProblemSubmissionData {
    source_code: string;
    language_id: number;
    expected_output: string;
}

export interface ModuleProblemSubmissionData {
    sourceCode: string;
    languageID: number;
    email: string;
    contentIndex: number;
}

export interface ProjectData {
    id: string;
    projectNumber: number;
    title: string;
    difficulty?: "easy" | "medium" | "hard"; // Optional - not used for projects
    description: string;
    instructions: string;
    starterFiles: Record<string, string>;
    testFile: {
        filename: string;
        content: string;
    };
    category: string;
    tags: string[];
    /** Concept IDs for transfer metrics (from backend) */
    conceptsExpected?: string[];
    limits?: {
        timeoutMs: number;
        memoryMB: number;
    };
}

export interface ProjectSubmissionData {
    problemId: string;
    userId: string;
    language: string;
    sourceType: "project";
    files: Record<string, string>;
    result: any;
    meta: {
        pyodideVersion: string;
    };
}

export interface DebugStackFrame {
    fn: string;
    file?: string;
    line?: number;
}

export interface DebugStep {
    file?: string;
    line?: number;
    stack: DebugStackFrame[] | string[];
    variables: Record<string, any>;
    output: string;
}
