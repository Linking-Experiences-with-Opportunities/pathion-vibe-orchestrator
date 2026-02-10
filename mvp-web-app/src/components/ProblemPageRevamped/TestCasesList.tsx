import React from "react";
import { TestCaseItem } from "./TestCaseItem";
import { TestCase } from "@/components/CodeEditor/types"
import { TestResult } from "./models"

interface TestCasesListProps {
  testCases: TestCase[];
  testResults: TestResult[];
  runIndividualTestCase: (testCaseNumber: number) => void
  activeTestCaseNumber: number | null;
  runningAll: boolean;
  code?: string;
}

export const TestCasesList: React.FC<TestCasesListProps> = ({
  testCases,
  testResults,
  runIndividualTestCase,
  activeTestCaseNumber,
  runningAll,
  code = "",
}) => {
  return (
    <div className="space-y-2">
      {testCases.map((test, index) => {
        const result = testResults.find((r) => r.name === test.Name);
        return (
          <TestCaseItem
            key={index}
            test={test}
            result={result}
            testCaseNumber={index}
            runIndividualTestCase={runIndividualTestCase}
            isLoading={runningAll || activeTestCaseNumber == index}
            code={code}
          />
        );
      })}
    </div>
  );
};
