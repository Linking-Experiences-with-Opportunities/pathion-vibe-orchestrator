package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/labstack/echo/v4"
)

// UserTestResult represents a single user test result
type UserTestResult struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "pass", "fail", or "error"
	Error  string `json:"error,omitempty"`
}

// BrowserSubmissionPayload represents the submission from the browser runner
type BrowserSubmissionPayload struct {
	ProblemID        string                 `json:"problemId"`
	UserID           string                 `json:"userId"`          // Should be Supabase UUID
	Email            string                 `json:"email,omitempty"` // User's email (optional, also extracted from JWT)
	Language         string                 `json:"language"`
	SourceType       string                 `json:"sourceType"` // "code" or "project"
	Files            map[string]string      `json:"files,omitempty"`
	UserTestsCode    string                 `json:"userTestsCode,omitempty"`
	UserTestsResults []UserTestResult       `json:"userTestsResults,omitempty"`
	Result           BrowserExecutionResult `json:"result"`
	Meta             BrowserExecutionMeta   `json:"meta"`
}

// BrowserExecutionResult contains the execution results
type BrowserExecutionResult struct {
	ExitCode    int                 `json:"exitCode"`
	Stdout      string              `json:"stdout"`
	Stderr      string              `json:"stderr"`
	TestSummary *BrowserTestSummary `json:"testSummary,omitempty"`
	DurationMs  int                 `json:"durationMs,omitempty"`
	TTFRMs      int                 `json:"ttfrMs,omitempty"`
}

// BrowserTestSummary contains test execution summary
type BrowserTestSummary struct {
	Total  int                     `json:"total"`
	Passed int                     `json:"passed"`
	Failed int                     `json:"failed"`
	Cases  []BrowserTestCaseResult `json:"cases"`
}

// BrowserTestCaseResult represents individual test case result
type BrowserTestCaseResult struct {
	ID         string      `json:"id,omitempty"`
	Fn         string      `json:"fn"`
	Passed     bool        `json:"passed"`
	Received   interface{} `json:"received,omitempty"`
	Expected   interface{} `json:"expected,omitempty"`
	DurationMs int         `json:"durationMs"`
	Error      string      `json:"error,omitempty"`
}

// BrowserExecutionMeta contains metadata about the execution
type BrowserExecutionMeta struct {
	PyodideVersion string         `json:"pyodideVersion"`
	TimedOut       bool           `json:"timedOut,omitempty"`
	MemExceeded    bool           `json:"memExceeded,omitempty"`
	SandboxBootMs  int            `json:"sandboxBootMs,omitempty"`
	FallbackUsed   bool           `json:"fallbackUsed,omitempty"`
	FallbackReason string         `json:"fallbackReason,omitempty"`
	EditorSignals  *EditorSignals `json:"editorSignals,omitempty"`
	VizPayload     interface{}    `json:"vizPayload,omitempty"` // VizPayloadV1
}

// EditorSignals contains clipboard and timing signals for investigation
// This is passive logging only - no raw text stored, only counts and timestamps
type EditorSignals struct {
	// Clipboard event counts
	CopyCount  int `json:"copyCount"`
	PasteCount int `json:"pasteCount"`

	// Character counts (no raw text)
	CopiedCharsTotal int `json:"copiedCharsTotal"`
	PastedCharsTotal int `json:"pastedCharsTotal"`

	// Timestamps for last events (Unix ms)
	LastCopyAtMs   int64 `json:"lastCopyAtMs,omitempty"`
	LastPasteAtMs  int64 `json:"lastPasteAtMs,omitempty"`
	LastRunAtMs    int64 `json:"lastRunAtMs,omitempty"`
	LastSubmitAtMs int64 `json:"lastSubmitAtMs,omitempty"`

	// Computed timing deltas (ms) - only set if paste happened before run/submit
	RunAfterPasteDeltaMs    *int64 `json:"runAfterPasteDeltaMs,omitempty"`
	SubmitAfterPasteDeltaMs *int64 `json:"submitAfterPasteDeltaMs,omitempty"`

	// Event history (capped arrays for payload size)
	CopyEvents  []ClipboardEvent `json:"copyEvents,omitempty"`
	PasteEvents []ClipboardEvent `json:"pasteEvents,omitempty"`

	// Optional: hash of pasted content for "large blob" detection (SHA-256 hex, no plaintext)
	LastPasteHash string `json:"lastPasteHash,omitempty"`
}

// ClipboardEvent represents a single copy/paste event (capped to last N events)
type ClipboardEvent struct {
	TimestampMs int64  `json:"timestampMs"`
	CharCount   int    `json:"charCount"`
	Hash        string `json:"hash,omitempty"` // SHA-256 hex digest, optional
}

// convertEditorSignals converts handler editor signals to database format
func convertEditorSignals(signals *EditorSignals) *database.EditorSignals {
	if signals == nil {
		return nil
	}

	// Convert copy events
	copyEvents := make([]database.ClipboardEvent, len(signals.CopyEvents))
	for i, e := range signals.CopyEvents {
		copyEvents[i] = database.ClipboardEvent{
			TimestampMs: e.TimestampMs,
			CharCount:   e.CharCount,
			Hash:        e.Hash,
		}
	}

	// Convert paste events
	pasteEvents := make([]database.ClipboardEvent, len(signals.PasteEvents))
	for i, e := range signals.PasteEvents {
		pasteEvents[i] = database.ClipboardEvent{
			TimestampMs: e.TimestampMs,
			CharCount:   e.CharCount,
			Hash:        e.Hash,
		}
	}

	return &database.EditorSignals{
		CopyCount:               signals.CopyCount,
		PasteCount:              signals.PasteCount,
		CopiedCharsTotal:        signals.CopiedCharsTotal,
		PastedCharsTotal:        signals.PastedCharsTotal,
		LastCopyAtMs:            signals.LastCopyAtMs,
		LastPasteAtMs:           signals.LastPasteAtMs,
		LastRunAtMs:             signals.LastRunAtMs,
		LastSubmitAtMs:          signals.LastSubmitAtMs,
		RunAfterPasteDeltaMs:    signals.RunAfterPasteDeltaMs,
		SubmitAfterPasteDeltaMs: signals.SubmitAfterPasteDeltaMs,
		CopyEvents:              copyEvents,
		PasteEvents:             pasteEvents,
		LastPasteHash:           signals.LastPasteHash,
	}
}

// convertTestSummary converts handler test summary to database format
func convertTestSummary(summary *BrowserTestSummary) *database.BrowserTestSummary {
	if summary == nil {
		return nil
	}

	cases := make([]database.BrowserTestCaseResult, len(summary.Cases))
	for i, c := range summary.Cases {
		cases[i] = database.BrowserTestCaseResult{
			ID:         c.ID,
			Fn:         c.Fn,
			Passed:     c.Passed,
			Received:   c.Received,
			Expected:   c.Expected,
			DurationMs: c.DurationMs,
			Error:      c.Error,
		}
	}

	return &database.BrowserTestSummary{
		Total:  summary.Total,
		Passed: summary.Passed,
		Failed: summary.Failed,
		Cases:  cases,
	}
}

// CreateQuestionSubmission handles POST /question/:number/submissions
// This maintains the existing API shape while using browser execution
func CreateQuestionSubmission(c echo.Context) error {
	// This is the same as CreateBrowserSubmission but with question number in URL
	return CreateBrowserSubmission(c)
}

// CreateBrowserSubmission handles POST /submissions
func CreateBrowserSubmission(c echo.Context) error {
	cfg := config.GetConfig()

	// Parse request body
	var payload BrowserSubmissionPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	// Get user claims from JWT - STRICT MODE: Source of Truth
	claims, ok := GetUserClaims(c)
	if !ok {
		c.Logger().Warnf("CreateBrowserSubmission: Failed to get user claims from context")
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid User UUID required",
		})
	}
	if claims.UserID == "" {
		c.Logger().Warnf("CreateBrowserSubmission: UserClaims.UserID is empty. Full claims: %+v", claims)
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid User UUID required",
		})
	}
	c.Logger().Infof("CreateBrowserSubmission: Successfully got user - UserID: %s, Email: %s", claims.UserID, claims.Email)

	email := claims.Email
	userID := claims.UserID // STRICT: Always use JWT UUID

	// Determine environment (cfg already declared at start of function)
	env := cfg.AppEnv
	if env == "" {
		if cfg.NodeEnv == "production" {
			env = "production"
		} else {
			env = "development"
		}
	}

	// Normalize email for consistent querying
	emailNormalized := strings.ToLower(strings.TrimSpace(email))

	// Determine if all tests passed
	passed := false
	if payload.Result.ExitCode == 0 && payload.Result.TestSummary != nil {
		passed = payload.Result.TestSummary.Failed == 0 && payload.Result.TestSummary.Total > 0
	}

	// Convert user test results to database format
	var userTestsResults []database.UserTestResult
	for _, ut := range payload.UserTestsResults {
		userTestsResults = append(userTestsResults, database.UserTestResult{
			Name:   ut.Name,
			Status: ut.Status,
			Error:  ut.Error,
		})
	}

	// Create submission document
	submission := database.BrowserSubmissionDocument{
		ProblemID:        payload.ProblemID,
		SupabaseUserID:   userID, // Supabase UUID - primary identifier
		UserID:           userID, // Legacy field - kept for backwards compatibility
		Email:            email,
		EmailNormalized:  emailNormalized, // Lowercase, trimmed for consistent queries
		Language:         payload.Language,
		SourceType:       payload.SourceType,
		Files:            payload.Files,
		UserTestsCode:    payload.UserTestsCode,
		UserTestsResults: userTestsResults,
		Result: database.BrowserExecutionResult{
			ExitCode:    payload.Result.ExitCode,
			Stdout:      payload.Result.Stdout,
			Stderr:      payload.Result.Stderr,
			TestSummary: convertTestSummary(payload.Result.TestSummary),
			DurationMs:  payload.Result.DurationMs,
			TTFRMs:      payload.Result.TTFRMs,
		},
		Meta: database.BrowserExecutionMeta{
			PyodideVersion: payload.Meta.PyodideVersion,
			TimedOut:       payload.Meta.TimedOut,
			MemExceeded:    payload.Meta.MemExceeded,
			SandboxBootMs:  payload.Meta.SandboxBootMs,
			FallbackUsed:   payload.Meta.FallbackUsed,
			FallbackReason: payload.Meta.FallbackReason,
			EditorSignals:  convertEditorSignals(payload.Meta.EditorSignals),
			VizPayload:     payload.Meta.VizPayload, // Pass through VizPayload
		},
		Passed:      passed,
		UserAgent:   c.Request().Header.Get("User-Agent"),
		Environment: env,
		CreatedAt:   time.Now(),
	}

	// Insert into MongoDB
	insertedID, err := database.CreateBrowserSubmission(&submission)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save submission",
		})
	}

	// If this is a problem submission and all tests passed, update user progress
	if passed && submission.SourceType == "code" {
		// TODO: Update user's solved problems when this feature is implemented
		// Parse problem ID to get question number
		// if questionNumber, err := strconv.Atoi(payload.ProblemID); err == nil {
		//     database.UpdateUserSolvedProblem(email, questionNumber)
		// }
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"submissionId":          insertedID,
		"passed":                passed,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}
