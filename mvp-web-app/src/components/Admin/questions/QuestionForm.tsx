"use client";

import { useState, useEffect } from "react"
import { pythonRunTestDriverTemplate, generateStarterCode, pythonSubmissionDriver } from "./CodeTemplate";
import { CodeSubmissionResponse } from "../models"
import { RunTestCasesForAdminPayload } from "../models";
import TestCasesSection from "./TestCasesSection"
import TestSolution from "./TestSolution";
import { getTestcasesJson } from "../utils"
import StarterCodeTemplate from "./StarterCodeTemplate";
import DriverCodeTemplate from "./DriverCodeTemplate";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { TestCase, QuestionPayload } from "../models";
import QuestionInformationSection from "./QuestionInformationSection"
import QuestionDescriptionSection from "./QuestionDescriptionSection";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface QuestionFormProps {
  mode: "create" | "edit";
  isSaving?: boolean;
  onSave: () => void;
  onDelete?: () => void;
  // Optional for controlled mode
  question?: QuestionPayload;
  onChange?: (q: QuestionPayload) => void;
  shouldShowSaveButton: boolean;
}

type Difficulty = "easy" | "medium" | "hard"
type ProgrammingLanguage = "python"

export default function QuestionForm({
  mode,
  question,
  onChange,
  shouldShowSaveButton = true,
}: QuestionFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState<string>(question?.title ?? "")
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? "easy")
  const [descriptionText, setDescriptionText] = useState(question?.description ?? "# Two Sum\n\nGiven an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.\n\n## Example\n\n```\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]\nExplanation: Because nums[0] + nums[1] == 9, we return [0, 1].\n```\n\n## Constraints\n\n- 2 <= nums.length <= 10^4\n- -10^9 <= nums[i] <= 10^9\n- -10^9 <= target <= 10^9\n- Only one valid answer exists.",)
  const [starterCodeTemplate, setStarterCodeTemplate] = useState<string>(question?.code_snippet ?? "")
  const [driverCode, setDriverCode] = useState<string>(question?.driver ?? "")
  const [testcases, setTestcases] = useState<TestCase[]>(question?.testcases ?? []);
  const [className, setClassName] = useState<string>(question?.className ?? "Solution");
  const [methodName, setMethodName] = useState<string>(question?.methodName ?? "add");

  const [tags, setTags] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  const [selectedLanguage, setSelectedLanguage] = useState<ProgrammingLanguage>("python")
  const [solution, setSolution] = useState<string>("")
  const [results, setResults] = useState<string>("``` \nRun your code to see the results\n ```\n")

  const addTestCase = () => {
    setTestcases([
      ...testcases,
      { input: "", expected_output: "" },
    ]);
  };

  useEffect(() => {
    if (!onChange) return;

    const testCasesJson = getTestcasesJson(testcases)
    const questionDriver = driverCode.trim()
      ? driverCode
      : pythonSubmissionDriver({
          testCasesJson: testCasesJson,
          className,
          methodName,
        })

    onChange({
      title,
      difficulty,
      description: descriptionText,
      methodName,
      className,
      code_snippet: starterCodeTemplate,
      testcases,
      driver: questionDriver,
    });
  }, [onChange, title, difficulty, descriptionText, methodName, className, starterCodeTemplate, driverCode, testcases]);

  // Initialize solution and starter code when className or methodName changes.
  // Only auto-generate starter code when empty (new question) to avoid overwriting custom code on edit.
  useEffect(() => {
    const updatedTemplate = generateStarterCode(className, methodName);
    setSolution(updatedTemplate);
    setStarterCodeTemplate((prev) => (prev ? prev : updatedTemplate));
  }, [className, methodName]);

  const handleRunTests = async () => {
    if (testcases.length < 1) {
      alert("You must add at least 1 test case!")
      return
    }
    if (methodName === undefined || methodName === "") {
      alert("Function name can't be missing")
      return
    }
    
    const testCasesJson = getTestcasesJson(testcases)
    let newPyDriver = pythonRunTestDriverTemplate({
      userCode: solution,
      testCasesJson: testCasesJson,
      className,
      methodName,
    })

    // STUBBED: Admin test running temporarily disabled
    // TODO: Integrate with Pyodide runner for admin interface
    setResults("Test execution is temporarily disabled in admin panel. Please test your code in the problem interface.");
    return;
  }

  async function handleSaveQuestion() {
    if (testcases.length < 1) {
      toast.error("You must add at least 1 test case!")
      return
    }
    if (methodName === undefined || methodName === "" || methodName.trim() === "") {
      toast.error("Method/Function name is required! This tells Pyodide which function to call.")
      return
    }
    if (title === undefined || title === "" || title.trim() === "") {
      toast.error("Question title is required!")
      return
    }
    const testCasesJson = getTestcasesJson(testcases)
    const questionDriver = driverCode.trim()
      ? driverCode
      : pythonSubmissionDriver({
          testCasesJson: testCasesJson,
          className,
          methodName,
        })
    
    const payload: QuestionPayload = {
      description: descriptionText,
      code_snippet: starterCodeTemplate,
      difficulty: difficulty,
      className: className,
      methodName: methodName,
      title: title,
      driver: questionDriver,
      testcases: testcases,
    }
    try {
      // Use relative path - fetchWithAuth will prepend API_ORIGIN
      console.log('[QuestionForm] Submitting to: /admin/question');
      console.log('[QuestionForm] Payload:', payload);
      const response = await fetchWithAuth('/admin/question', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log('[QuestionForm] Response status:', response.status);
      
      const data: {success: boolean, id: string} = await response.json();
      console.log(data)
      if (data.success) {
        router.push("/admin/questions?toast=created");
      } else {
        toast.error("Something went wrong saving the problem");
      }
    } catch (error: any) {
        console.error('Error:', error);
        toast.error("An unexpected error occurred saving the problem");
    }
  }

  async function handleUpdateQuestion() {
    const q = question as (QuestionPayload & { _id?: string; id?: string }) | undefined;
    if (!q?._id && !q?.id) {
      toast.error("Cannot update: Question ID is missing");
      return;
    }

    if (testcases.length < 1) {
      toast.error("You must add at least 1 test case!");
      return;
    }
    if (!methodName?.trim()) {
      toast.error("Method/Function name is required!");
      return;
    }
    if (!title?.trim()) {
      toast.error("Question title is required!");
      return;
    }

    const testCasesJson = getTestcasesJson(testcases);
    const questionDriver = driverCode.trim()
      ? driverCode
      : pythonSubmissionDriver({
          testCasesJson,
          className,
          methodName,
        });

    const payload: QuestionPayload = {
      description: descriptionText,
      code_snippet: starterCodeTemplate,
      difficulty: difficulty,
      className,
      methodName,
      title,
      driver: questionDriver,
      testcases,
    };

    try {
      const id = q._id ?? q.id;
      // Note: PUT /admin/questions/:id endpoint may not exist yet in backend
      const response = await fetchWithAuth(
        `/admin/questions/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to update");
      }

      const data = await response.json();
      if (data.success) {
        toast.success("Question updated successfully!");
        router.push("/admin/questions");
      } else {
        toast.error("Failed to update question");
      }
    } catch (error: unknown) {
      console.error("Error:", error);
      toast.error("An error occurred while updating");
    }
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 ">
        <QuestionInformationSection 
            mode={mode}
            title={title}
            setTitle={setTitle}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            tags={tags}
            setTags={setTags}
            status={status}
            setStatus={setStatus}
        />
        
        <QuestionDescriptionSection
          descriptionText={descriptionText}
          setDescriptionText={setDescriptionText}
        />

        <TestCasesSection
          className={className}
          methodName={methodName}
          setMethodName={setMethodName}
          setClassName={setClassName}
          addTestCase={addTestCase}
          testCases={testcases}
          setTestCases={setTestcases}
        />

        <StarterCodeTemplate
          starterCodeTemplate={starterCodeTemplate}
          selectedLanguage={selectedLanguage}
          setStarterCodeTemplate={setStarterCodeTemplate}
        />

        <DriverCodeTemplate
          driverCode={driverCode}
          selectedLanguage={selectedLanguage}
          setDriverCode={setDriverCode}
        />

        <TestSolution
            handleRunTests={handleRunTests}
            solution={solution}
            selectedLanguage={selectedLanguage}
            setSolution={setSolution}
            results={results}
        />
      </div>

      {shouldShowSaveButton && 
        <div className="flex ">
          <button 
            className="bg-green-600 hover:bg-green-800 py-2 rounded w-full"
            // if 
            onClick={mode === "create" ? handleSaveQuestion : handleUpdateQuestion}
          >
            Save
          </button>
        </div>
      }
    </>
  );
}
