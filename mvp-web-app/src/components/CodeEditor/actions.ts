// actions.ts

import {
    ProblemSubmissionData,
    ModuleProblemSubmissionData,
    ProblemSubmissionResponse,
    QuestionData,
    ModuleProblemSubmissionResponse,
    ProjectData,
    ProjectSubmissionData,
} from "@/components/CodeEditor/types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getApiUrl } from "@/lib/apiConfig";

export const fetchProblemData = async (problemNumber: string): Promise<QuestionData> => {
    const url = getApiUrl(`/question/${problemNumber}`);
    const response = await fetch(url);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error fetching problem data: ${errorText}`);
    }

    const data: QuestionData = await response.json();
    return data;
};

/**
 * Submits a problem solution to the server.
 * @param problemNumber - The identifier for the problem.
 * @param submissionData - The data containing the user's solution.
 * @returns A promise that resolves to the server's response.
 */
export const submitProblem = async (
    problemNumber: string,
    submissionData: ProblemSubmissionData
): Promise<ProblemSubmissionResponse> => {
    const url = getApiUrl(`/question/${problemNumber}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(submissionData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error submitting problem: ${errorText}`);
        }

        const data: ProblemSubmissionResponse = await response.json();
        return data;
    } catch (error: any) {
        console.error('Error:', error);
        throw error;
    }
};

export const submitModuleProblem = async (
    moduleId: string,
    submissionData: ModuleProblemSubmissionData
): Promise<ModuleProblemSubmissionResponse> => {
    const url = getApiUrl(`/modules/${moduleId}/submission`);

    const payload = {
        source_code: submissionData.sourceCode,
        language_id: submissionData.languageID,
        email: submissionData.email,
        content_index: submissionData.contentIndex,
    };

    try {
        const response = await fetchWithAuth(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error submitting problem: ${errorText}`);
        }

        const data: ModuleProblemSubmissionResponse = await response.json();
        return data;
    } catch (error: any) {
        console.error('Error:', error);
        throw error;
    }
};

// Helper to validate project ID is a projectNumber (integer), not MongoDB ObjectId
const isValidProjectNumber = (id: string): boolean => {
    // projectNumber should be a numeric string like "1", "2", "42"
    // MongoDB ObjectIds are 24 hex characters
    const isNumeric = /^\d+$/.test(id);
    const looksLikeMongoId = /^[a-f0-9]{24}$/i.test(id);
    return !looksLikeMongoId && isNumeric;
};

export const fetchProjectData = async (projectId: string): Promise<ProjectData> => {
    isValidProjectNumber(projectId);
    
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/projects/${projectId}`;
    
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error fetching project data: ${errorText}`);
    }
    
    const { project } = await response.json();
    return project;
};

export const submitProject = async (
    submissionData: ProjectSubmissionData
): Promise<any> => {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/submissions`;
    
    const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData),
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error submitting project: ${errorText}`);
    }
    
    return await response.json();
};

