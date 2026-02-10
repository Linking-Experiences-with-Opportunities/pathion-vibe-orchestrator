package database

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// BrowserSubmissionDocument represents how we store browser submissions
type BrowserSubmissionDocument struct {
	ID               primitive.ObjectID     `bson:"_id,omitempty" json:"_id"`
	ProblemID        string                 `bson:"problemId" json:"problemId"`
	SupabaseUserID   string                 `bson:"supabaseUserId,omitempty" json:"supabaseUserId,omitempty"`   // New UUID
	UserID           string                 `bson:"userId" json:"userId"`                                       // Legacy ID (email or uuid)
	Email            string                 `bson:"email,omitempty" json:"email,omitempty"`                     // Original email
	EmailNormalized  string                 `bson:"emailNormalized,omitempty" json:"emailNormalized,omitempty"` // Lowercase, trimmed email for queries
	Language         string                 `bson:"language" json:"language"`
	SourceType       string                 `bson:"sourceType" json:"sourceType"`
	Files            map[string]string      `bson:"files,omitempty" json:"files,omitempty"`
	UserTestsCode    string                 `bson:"userTestsCode,omitempty" json:"userTestsCode,omitempty"`
	UserTestsResults []UserTestResult       `bson:"userTestsResults,omitempty" json:"userTestsResults,omitempty"`
	Result           BrowserExecutionResult `bson:"result" json:"result"`
	Meta             BrowserExecutionMeta   `bson:"meta" json:"meta"`
	Passed           bool                   `bson:"passed" json:"passed"`
	UserAgent        string                 `bson:"userAgent,omitempty" json:"userAgent,omitempty"`
	Environment      string                 `bson:"environment,omitempty" json:"environment,omitempty"` // "production", "staging", "development"
	CreatedAt        time.Time              `bson:"createdAt" json:"createdAt"`
}

// UserTestResult represents a single user test result
type UserTestResult struct {
	Name   string `bson:"name" json:"name"`
	Status string `bson:"status" json:"status"` // "pass", "fail", or "error"
	Error  string `bson:"error,omitempty" json:"error,omitempty"`
}

// BrowserExecutionResult contains the execution results
type BrowserExecutionResult struct {
	ExitCode    int                 `bson:"exitCode" json:"exitCode"`
	Stdout      string              `bson:"stdout" json:"stdout"`
	Stderr      string              `bson:"stderr" json:"stderr"`
	TestSummary *BrowserTestSummary `bson:"testSummary,omitempty" json:"testSummary,omitempty"`
	DurationMs  int                 `bson:"durationMs,omitempty" json:"durationMs,omitempty"`
	TTFRMs      int                 `bson:"ttfrMs,omitempty" json:"ttfrMs,omitempty"`
}

// BrowserTestSummary contains test execution summary
type BrowserTestSummary struct {
	Total  int                     `bson:"total" json:"total"`
	Passed int                     `bson:"passed" json:"passed"`
	Failed int                     `bson:"failed" json:"failed"`
	Cases  []BrowserTestCaseResult `bson:"cases" json:"cases"`
}

// BrowserTestCaseResult represents individual test case result
type BrowserTestCaseResult struct {
	ID         string      `bson:"id,omitempty" json:"id,omitempty"`
	Fn         string      `bson:"fn" json:"fn"`
	Passed     bool        `bson:"passed" json:"passed"`
	Received   interface{} `bson:"received,omitempty" json:"received,omitempty"`
	Expected   interface{} `bson:"expected,omitempty" json:"expected,omitempty"`
	DurationMs int         `bson:"durationMs" json:"durationMs"`
	Error      string      `bson:"error,omitempty" json:"error,omitempty"`
}

// BrowserExecutionMeta contains metadata about the execution
type BrowserExecutionMeta struct {
	PyodideVersion string         `bson:"pyodideVersion" json:"pyodideVersion"`
	TimedOut       bool           `bson:"timedOut,omitempty" json:"timedOut,omitempty"`
	MemExceeded    bool           `bson:"memExceeded,omitempty" json:"memExceeded,omitempty"`
	SandboxBootMs  int            `bson:"sandboxBootMs,omitempty" json:"sandboxBootMs,omitempty"`
	FallbackUsed   bool           `bson:"fallbackUsed,omitempty" json:"fallbackUsed,omitempty"`
	FallbackReason string         `bson:"fallbackReason,omitempty" json:"fallbackReason,omitempty"`
	EditorSignals  *EditorSignals `bson:"editorSignals,omitempty" json:"editorSignals,omitempty"`
	VizPayload     interface{}    `bson:"vizPayload,omitempty" json:"vizPayload,omitempty"` // VizPayloadV1
}

// EditorSignals contains clipboard and timing signals for investigation
// This is passive logging only - no raw text stored, only counts and timestamps
type EditorSignals struct {
	// Clipboard event counts
	CopyCount  int `bson:"copyCount" json:"copyCount"`
	PasteCount int `bson:"pasteCount" json:"pasteCount"`

	// Character counts (no raw text)
	CopiedCharsTotal int `bson:"copiedCharsTotal" json:"copiedCharsTotal"`
	PastedCharsTotal int `bson:"pastedCharsTotal" json:"pastedCharsTotal"`

	// Timestamps for last events (Unix ms)
	LastCopyAtMs   int64 `bson:"lastCopyAtMs,omitempty" json:"lastCopyAtMs,omitempty"`
	LastPasteAtMs  int64 `bson:"lastPasteAtMs,omitempty" json:"lastPasteAtMs,omitempty"`
	LastRunAtMs    int64 `bson:"lastRunAtMs,omitempty" json:"lastRunAtMs,omitempty"`
	LastSubmitAtMs int64 `bson:"lastSubmitAtMs,omitempty" json:"lastSubmitAtMs,omitempty"`

	// Computed timing deltas (ms) - only set if paste happened before run/submit
	RunAfterPasteDeltaMs    *int64 `bson:"runAfterPasteDeltaMs,omitempty" json:"runAfterPasteDeltaMs,omitempty"`
	SubmitAfterPasteDeltaMs *int64 `bson:"submitAfterPasteDeltaMs,omitempty" json:"submitAfterPasteDeltaMs,omitempty"`

	// Event history (capped arrays for payload size)
	CopyEvents  []ClipboardEvent `bson:"copyEvents,omitempty" json:"copyEvents,omitempty"`
	PasteEvents []ClipboardEvent `bson:"pasteEvents,omitempty" json:"pasteEvents,omitempty"`

	// Optional: hash of pasted content for "large blob" detection (SHA-256 hex, no plaintext)
	LastPasteHash string `bson:"lastPasteHash,omitempty" json:"lastPasteHash,omitempty"`
}

// ClipboardEvent represents a single copy/paste event (capped to last N events)
type ClipboardEvent struct {
	TimestampMs int64  `bson:"timestampMs" json:"timestampMs"`
	CharCount   int    `bson:"charCount" json:"charCount"`
	Hash        string `bson:"hash,omitempty" json:"hash,omitempty"` // SHA-256 hex digest, optional
}

// RunnerEventDocument represents how we store runner events
type RunnerEventDocument struct {
	ID              primitive.ObjectID     `bson:"_id,omitempty"`
	Event           string                 `bson:"event"`
	Properties      map[string]interface{} `bson:"properties,omitempty"`
	UserID          string                 `bson:"userId,omitempty"`
	Email           string                 `bson:"email,omitempty"`           // User's email for routing and analytics
	EmailNormalized string                 `bson:"emailNormalized,omitempty"` // Lowercase, trimmed email for consistent queries
	SessionID       string                 `bson:"sessionId,omitempty"`
	UserAgent       string                 `bson:"userAgent,omitempty"`
	IP              string                 `bson:"ip,omitempty"`
	Environment     string                 `bson:"environment,omitempty"` // "production", "staging", "development"
	CreatedAt       time.Time              `bson:"createdAt"`
}

// CreateBrowserSubmission inserts a new browser submission into MongoDB
// Runtime data - writes to app DB (or dev DB for internal users)
func CreateBrowserSubmission(submission *BrowserSubmissionDocument) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Route internal users to dev database to avoid polluting production metrics
	var collection *mongo.Collection
	if IsInternalUser(submission.Email) || IsInternalUser(submission.EmailNormalized) {
		collection = GetDevDb().Collection("browser_submissions")
	} else {
		collection = GetAppDb().Collection("browser_submissions")
	}

	result, err := collection.InsertOne(ctx, submission)
	if err != nil {
		return "", err
	}

	// Convert ObjectID to string
	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		return oid.Hex(), nil
	}

	return "", nil
}

// CreateRunnerEvent inserts a new telemetry event into MongoDB
// Runtime data - writes to app DB (or dev DB for internal users)
func CreateRunnerEvent(event *RunnerEventDocument) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Route internal users to dev database to avoid polluting production metrics
	// Check Email field first, then fall back to UserID (which may be an email in legacy data)
	var collection *mongo.Collection
	if IsInternalUser(event.Email) || IsInternalUser(event.UserID) {
		collection = GetDevDb().Collection("runner_events")
	} else {
		collection = GetAppDb().Collection("runner_events")
	}

	_, err := collection.InsertOne(ctx, event)
	return err
}
