package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func CreateModule(c echo.Context) error {
	var payload shared.ModulePayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request data"})
	}

	// Admin content creation - write to content DB
	moduleId, err := database.ContentCollections.Modules.CreateModule(context.Background(), payload)
	if err != nil {
		response := struct {
			Success bool   `json:"success"`
			ID      string `json:"id"`
		}{
			Success: false,
			ID:      "",
		}
		return c.JSON(http.StatusInternalServerError, response)
	}

	response := struct {
		Success bool   `json:"success"`
		ID      string `json:"id"`
	}{
		Success: true,
		ID:      moduleId,
	}

	log.Println(fmt.Sprintf("Response: %+v", response))
	return c.JSON(http.StatusOK, response)
}

func GetAllModules(c echo.Context) error {
	// Read from content DB
	modules, err := database.ContentCollections.Modules.GetAllModules(c.Request().Context())
	if err != nil {
		return c.String(http.StatusNotFound, "There was a problem fetching all questions")
	}
	return c.JSON(http.StatusOK, modules)
}

func GetModule(c echo.Context) error {
	moduleId := c.Param("id")

	// Read from content DB. GetModuleByID uses the aggregation pipeline and returns
	// the module with content.data already populated with live Project/Question data.
	m, err := database.ContentCollections.Modules.GetModuleByID(c.Request().Context(), moduleId)
	if err != nil {
		notFoundMessage := fmt.Sprintf("Module with id [%v] does not exist.", moduleId)
		return c.String(http.StatusNotFound, notFoundMessage)
	}

	return c.JSON(http.StatusOK, m)
}

func RunModuleTestCases(c echo.Context) error {
	var payload shared.RunModuleTestCasePayload
	if err := c.Bind(&payload); err != nil {
		log.Println("Error decoding payload:", err.Error())
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	moduleId := c.Param("id")

	// Read from content DB
	module, err := database.ContentCollections.Modules.GetModuleByID(c.Request().Context(), moduleId)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Something went wrong. Please try again later.")
	}

	if payload.ContentIndex >= len(module.Content) {
		log.Println(fmt.Sprintf("Content Index: %d is invalid", payload.ContentIndex))
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if module.Content[payload.ContentIndex].Type != shared.Question {
		log.Println("Can't run test cases for a content type that isn't 'question'.")
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	rawData := module.Content[payload.ContentIndex].Data
	question, err := database.ToStruct[shared.QuestionDocument](rawData)
	if err != nil {
		log.Println("Error casting content data to QuestionDocument:", err)
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	var testCases []shared.TestCaseDocument
	if payload.RunAllCases {
		testCases = question.Testcases
	} else {
		index := getTestcaseIndex(question.Testcases, payload.TestCaseNumber)
		testCase := question.Testcases[index]
		testCases = []shared.TestCaseDocument{testCase}
	}

	testCaseSubmission := shared.SubmissionPayload{
		SourceCode:     fmt.Sprintf(question.Driver, payload.SourceCode),
		LanguageID:     payload.LanguageID,
		ExpectedOutput: GetExpectedOutputListFromTestcases(&question),
	}

	token, err := createCodeSubmission(testCaseSubmission)
	if err != nil {
		log.Println(err.Error())
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to run test case")
	}

	submissionData := GetSubmissionDataFromToken(token)
	if submissionData == nil || !isCompleteSubmission(submissionData.StatusId) {
		errorTestResults := getErrorTestResults(testCases, payload, submissionData)
		// TODO: Update test case obj to include more info to client rather than just testcase updates?
		return echo.NewHTTPError(http.StatusGatewayTimeout, errorTestResults)
	}

	results, err := ParseJudge0Results(submissionData.Stdout)
	if err != nil || submissionData.StatusId >= 6 || submissionData.Stdout == "" {
		// TODO: Update test case obj to include more info to client rather than just testcase updates?
		errorTestResults := getErrorTestResults(testCases, payload, submissionData)
		return echo.NewHTTPError(http.StatusInternalServerError, errorTestResults)
	}

	var combinedResults []shared.TestResult
	for i := range testCases {
		if i >= len(results) {
			break // or handle missing result
		}
		tc := testCases[i]
		tr := results[i]

		var testCaseNumber int
		// Test case numbers are offset by 1
		if payload.RunAllCases {
			testCaseNumber = i + 1
		} else {
			testCaseNumber = payload.TestCaseNumber + 1
		}

		result := shared.TestResult{
			Name:     fmt.Sprintf("Test case %d", testCaseNumber),
			Expected: tc.ExpectedOutput,
			Actual:   tr.Message, // assuming 'Message' contains the actual output
			Passed:   tr.Status == "passed",
			Printed:  tr.Printed,
		}

		combinedResults = append(combinedResults, result)
	}

	// Return the newly created test case
	return c.JSON(http.StatusOK, combinedResults)
}

func CreateModuleQuestionSubmission(c echo.Context) error {
	var payload shared.ModuleQuestionSubmissionPayload
	if err := c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	moduleId := c.Param("id")
	// Read from content DB
	module, err := database.ContentCollections.Modules.GetModuleByID(c.Request().Context(), moduleId)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Something went wrong. Please try again later.")
	}

	if payload.ContentIndex >= len(module.Content) {
		log.Println(fmt.Sprintf("Content Index: %d is invalid", payload.ContentIndex))
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if module.Content[payload.ContentIndex].Type != shared.Question {
		log.Println("Can't run test cases for a content type that isn't 'question'.")
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	moduleContent := module.Content[payload.ContentIndex]
	rawData := moduleContent.Data
	question, err := database.ToStruct[shared.QuestionDocument](rawData)
	if err != nil {
		log.Println("Error casting content data to QuestionDocument:", err)
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	submission := shared.SubmissionPayload{
		Email:          payload.Email,
		SourceCode:     fmt.Sprintf(question.Driver, payload.SourceCode),
		LanguageID:     payload.LanguageID,
		ExpectedOutput: GetExpectedOutputListFromTestcases(&question),
	}

	token, err := createCodeSubmission(submission)
	if err != nil {
		log.Println("Error submitting code submission: ", err.Error())
		return echo.NewHTTPError(http.StatusInternalServerError, "Error submitting code submission")
	}

	// Attempt to get code submission response
	submissionData := GetSubmissionDataFromToken(token)
	if submissionData == nil || !isCompleteSubmission(submissionData.StatusId) {
		return c.String(http.StatusGatewayTimeout, "Submission never finished executing within the expected time, try again")
	}

	results, err := ParseJudge0Results(submissionData.Stdout)
	if err != nil {
		log.Println("Failed to parse judge0results: ", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "There was a problem getting the code submission response")
	}

	var questionsCorrect = 0
	for _, result := range results {
		if result.Status == shared.CodeSubmissionPassed {
			questionsCorrect += 1
		}
	}

	passedAllTestCases := questionsCorrect == len(question.Testcases)
	submissionDoc := shared.ModuleSubmissionDocument{
		ID:                 primitive.NewObjectID(),
		Email:              submission.Email,
		SourceCode:         payload.SourceCode,
		LanguageID:         submission.LanguageID,
		PassedAllTestcases: passedAllTestCases,
		ModuleContentID:    moduleContent.ID,
		Result:             results,
		CreatedAt:          time.Now(),
	}
	// Runtime data - write to app DB
	submissionId, err := database.AppCollections.ModuleSubmissions.CreateSubmission(c.Request().Context(), submissionDoc)
	if err != nil {
		log.Println("Error saving submission: ", err.Error())
		return echo.NewHTTPError(http.StatusInternalServerError, "There was a problem saving the submission")
	}

	response := map[string]interface{}{
		"submissionId":       submissionId,
		"passedAllTestCases": passedAllTestCases,
	}
	return c.JSON(http.StatusOK, response)
}

func UpdateModule(c echo.Context) error {
	moduleID := c.Param("id")
	if moduleID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Missing module ID in path"})
	}

	var payload shared.UpdateModulePayload
	if err := c.Bind(&payload); err != nil {
		log.Printf("UpdateModule: failed to bind payload for module %s: %v", moduleID, err)
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request body"})
	}

	// Log payload details for debugging
	if payload.Content != nil {
		log.Printf("UpdateModule: module %s has %d content items", moduleID, len(*payload.Content))
		for i, item := range *payload.Content {
			log.Printf("UpdateModule: content[%d] type=%q, id=%q, data keys=%v", i, item.Type, item.ID, getContentDataKeys(item.Data))
		}
	}

	// Admin content update - write to content DB
	err := database.ContentCollections.Modules.UpdateModule(context.Background(), moduleID, payload)
	if err != nil {
		log.Printf("UpdateModule: failed to update module %s: %v", moduleID, err)
		return c.String(http.StatusInternalServerError, fmt.Sprintf("Failed to update module: %v", err))
	}

	return c.String(http.StatusOK, "Updated module!")
}

// getContentDataKeys returns the keys of the content data map for logging
func getContentDataKeys(data map[string]interface{}) []string {
	if data == nil {
		return nil
	}
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	return keys
}

func DeleteModule(c echo.Context) error {
	moduleId := c.Param("id")

	// Admin content deletion - write to content DB
	didDelete, err := database.ContentCollections.Modules.DeleteModule(context.Background(), moduleId)
	if err != nil {
		log.Println(fmt.Sprintf("There was an error deleting the module with id: %s. Error: %s", moduleId, err.Error()))
		return c.String(http.StatusInternalServerError, "There was a problem deleting the module.")
	}

	if !didDelete {
		log.Println("Module didn't delete for some reason.")
		return c.String(http.StatusInternalServerError, "There was a problem deleting the module.")
	}

	return c.String(http.StatusOK, "")
}
