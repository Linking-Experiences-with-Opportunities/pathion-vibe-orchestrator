package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
)

// ProblemListItem represents a problem in the list
type ProblemListItem struct {
	ID             string                `json:"id"`  // QuestionNumber as string for backward compatibility
	MongoID        string                `json:"_id"` // MongoDB Object ID for references (e.g. module links)
	QuestionNumber int                   `json:"questionNumber"`
	Title          string                `json:"title"`
	Difficulty     shared.DifficultyType `json:"difficulty"`
	Description    string                `json:"description"`
	UpdatedAt      time.Time             `json:"updatedAt"` // Add this
}

// ProblemDetail represents detailed problem information
type ProblemDetail struct {
	ID             string                    `json:"id"`
	QuestionNumber int                       `json:"questionNumber"`
	Title          string                    `json:"title"`
	Difficulty     shared.DifficultyType     `json:"difficulty"`
	Description    string                    `json:"description"`
	FunctionName   string                    `json:"functionName"`
	CodeSnippet    string                    `json:"codeSnippet"`
	Driver         string                    `json:"driver"`
	Tests          []shared.TestCaseDocument `json:"tests"`
	Files          map[string]string         `json:"files,omitempty"` // For multi-file problems
	Entry          string                    `json:"entry"`           // Entry point (e.g., "main.py")
	Limits         ProblemLimits             `json:"limits"`
}

// ProblemLimits defines execution constraints
type ProblemLimits struct {
	TimeoutMs int `json:"timeoutMs"`
	MemoryMB  int `json:"memoryMB"`
}

// GetProblems returns a list of all problems
func GetProblems(c echo.Context) error {
	cfg := config.GetConfig()

	questions, err := database.GetAllQuestions()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch problems",
		})
	}

	// Convert to problem list items
	problems := make([]ProblemListItem, len(questions))
	for i, q := range questions {
		problems[i] = ProblemListItem{
			ID:             strconv.Itoa(q.QuestionNumber),
			MongoID:        q.ID.Hex(),
			QuestionNumber: q.QuestionNumber,
			Title:          q.Title,
			Difficulty:     q.Difficulty,
			Description:    q.Description,
			UpdatedAt:      q.UpdatedAt,
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"problems":              problems,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}

// GetProblemByID returns detailed problem information
func GetProblemByID(c echo.Context) error {
	cfg := config.GetConfig()

	// Parse problem ID
	idStr := c.Param("id")
	questionNumber, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid problem ID",
		})
	}

	// Fetch question
	question, err := database.GetQuestionByNumber(questionNumber)
	if err != nil || question == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Problem not found",
		})
	}

	// Extract function name from code snippet (basic parsing)
	functionName := extractFunctionName(question.CodeSnippet)

	// Prepare problem detail
	problem := ProblemDetail{
		ID:             strconv.Itoa(question.QuestionNumber),
		QuestionNumber: question.QuestionNumber,
		Title:          question.Title,
		Difficulty:     question.Difficulty,
		Description:    question.Description,
		FunctionName:   functionName,
		CodeSnippet:    question.CodeSnippet,
		Driver:         question.Driver,
		Tests:          question.Testcases,
		Files:          nil, // Single-file problems have no additional files
		Entry:          "main.py",
		Limits: ProblemLimits{
			TimeoutMs: 5000, // 5 seconds
			MemoryMB:  128,  // 128 MB
		},
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"problem":               problem,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}

// extractFunctionName attempts to extract the function name from Python code
func extractFunctionName(codeSnippet string) string {
	// This is a simple implementation - you might want to use a proper parser
	// Look for "def function_name(" pattern
	defPrefix := "def "
	startIdx := 0

	for {
		idx := startIdx
		defIdx := -1

		// Find "def " in the string
		for i := idx; i <= len(codeSnippet)-len(defPrefix); i++ {
			if codeSnippet[i:i+len(defPrefix)] == defPrefix {
				defIdx = i + len(defPrefix)
				break
			}
		}

		if defIdx == -1 {
			break
		}

		// Extract function name
		nameEnd := defIdx
		for nameEnd < len(codeSnippet) && codeSnippet[nameEnd] != '(' && codeSnippet[nameEnd] != ' ' && codeSnippet[nameEnd] != ':' {
			nameEnd++
		}

		if nameEnd > defIdx {
			return codeSnippet[defIdx:nameEnd]
		}

		startIdx = defIdx
	}

	// Default fallback
	return "solution"
}
