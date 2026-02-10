
export type ParameterType = "string" | "number" | "boolean" | "array" | "object"

interface AdminTestCasePayload {
    expected_output: string
    Input: string
    QuestionNumber: number
}

export interface RunTestCasesForAdminPayload {
    SourceCode: string
    FunctionName: string
    LanguageID: number
    expected_output: string[]
    testcases: AdminTestCasePayload[]
}

type Difficulty = "easy" | "medium" | "hard"

export interface QuestionPayload {
    description: string;
    code_snippet: string;
    difficulty: Difficulty;
    methodName: string;
    className: string;
    title: string;
    driver?: string;
    testcases: TestCase[]
}

export interface VideoPayload {
    title: string;
    videoUrl: string;
}

/**
 * Project content payload for module content items.
 * This is the full project definition stored in the `data` field of a project content item.
 */
export interface ProjectPayload {
    id: string;
    projectNumber: number;
    title: string;
    difficulty?: "easy" | "medium" | "hard";
    description: string;
    instructions: string;
    starterFiles: Record<string, string>;
    testFile: {
        filename: string;
        content: string;
    };
    category: string;
    tags: string[];
    limits?: {
        timeoutMs: number;
        memoryMB: number;
    };
}

/**
 * Creates default empty project payload for new project content items.
 */
export function createDefaultProjectPayload(): ProjectPayload {
    return {
        id: Date.now().toString(),
        projectNumber: 0,
        title: "",
        description: "",
        instructions: "",
        starterFiles: { "main.py": "" },
        testFile: {
            filename: "test_main.py",
            content: "",
        },
        category: "",
        tags: [],
        limits: {
            timeoutMs: 10000,
            memoryMB: 256,
        },
    };
}

export interface TestCase {
    input: string;
    expected_output: string;
}

export interface TestCaseRunResult {
    case: number;
    status: string;
}

export interface CodeSubmissionResponse {
    token: string;
    language_id: number;
    stdout: string;
    status_id: number;
    stderr: string;
    message: string;
    status: {
      id: number;
      description: string;
    };
}
  