package handlers

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// ============================================================
// Request Payload Types
// ============================================================

// DTEventPayload is the request body for POST /decision-trace/event.
type DTEventPayload struct {
	ContentID           string                  `json:"contentId"`
	ContentType         string                  `json:"contentType"` // "project" | "problem" | "module_problem"
	Language            string                  `json:"language"`
	EventType           string                  `json:"eventType"` // "RUN" | "SUBMIT"
	CodeText            string                  `json:"codeText"`
	BrowserSubmissionID *string                 `json:"browserSubmissionId,omitempty"`
	Execution           *DTExecutionPayload     `json:"execution,omitempty"`
	Visualization       *DTVisualizationPayload `json:"visualization,omitempty"`
	AI                  *DTAIPayload            `json:"ai,omitempty"`
}

// DTExecutionPayload mirrors the execution summary from the frontend.
type DTExecutionPayload struct {
	UniversalErrorCode *string               `json:"universalErrorCode"`
	ErrorLog           *string               `json:"errorLog"`
	Stdout             *string               `json:"stdout"`
	RuntimeMs          *int                  `json:"runtimeMs"`
	MemoryKb           *int                  `json:"memoryKb"`
	Tests              *DTTestSummaryPayload `json:"tests"`
	TestResults        []DTTestResultPayload `json:"testResults"`
}

// DTTestSummaryPayload holds pass/fail counts from the frontend.
type DTTestSummaryPayload struct {
	Total  *int `json:"total"`
	Passed *int `json:"passed"`
	Failed *int `json:"failed"`
}

// DTTestResultPayload holds individual test results from the frontend.
type DTTestResultPayload struct {
	TestName     string  `json:"testName"`
	Status       string  `json:"status"`
	Message      *string `json:"message"`
	ErrorCode    *string `json:"errorCode"`
	ErrorTooltip *string `json:"errorTooltip"`
}

// DTVisualizationPayload holds optional Mermaid visualization data and state snapshot.
type DTVisualizationPayload struct {
	Kind          *string                `json:"kind"`
	MermaidText   *string                `json:"mermaidText"`
	StateSnapshot map[string]interface{} `json:"stateSnapshot,omitempty"`
}

// DTAIPayload holds AI artifacts from both nano and gemini layers.
type DTAIPayload struct {
	Nano   *DTAINanoPayload   `json:"nano"`
	Gemini *DTAIGeminiPayload `json:"gemini"`
}

// DTAINanoPayload holds fast/cheap nano-layer output.
type DTAINanoPayload struct {
	Enabled       bool    `json:"enabled"`
	PromptVersion *string `json:"promptVersion"`
	Summary       *string `json:"summary"`
}

// DTAIGeminiPayload holds larger-model gemini-layer output.
type DTAIGeminiPayload struct {
	Enabled         bool                      `json:"enabled"`
	Model           *string                   `json:"model"`
	PromptVersion   *string                   `json:"promptVersion"`
	NudgeType       *string                   `json:"nudgeType"`
	ResponseText    *string                   `json:"responseText"`
	CitedLineRanges []DTCitedLineRangePayload `json:"citedLineRanges"`
}

// DTCitedLineRangePayload identifies a line range for code highlighting.
type DTCitedLineRangePayload struct {
	File      *string `json:"file"`
	StartLine int     `json:"startLine"`
	EndLine   int     `json:"endLine"`
}

// ============================================================
// Validation Helpers
// ============================================================

var validContentTypes = map[string]bool{
	"project":        true,
	"problem":        true,
	"module_problem": true,
}

var validEventTypes = map[string]bool{
	"RUN":    true,
	"SUBMIT": true,
}

// maxTestResults caps how many individual test results we store per event (V1).
const maxTestResults = 10

// isAdminClaims checks if the user has admin-level access (internal email or admin role).
func isAdminClaims(claims shared.UserClaims) bool {
	return shared.IsInternalUser(claims.Email) || claims.Role == "admin"
}

// allTestsPassed returns true if the execution indicates all tests passed.
func allTestsPassed(exec *DTExecutionPayload) bool {
	if exec == nil || exec.Tests == nil {
		return false
	}
	if exec.Tests.Total == nil || exec.Tests.Failed == nil {
		return false
	}
	return *exec.Tests.Total > 0 && *exec.Tests.Failed == 0
}

// ============================================================
// Payload → Database Conversion
// ============================================================

func convertDTExecution(p *DTExecutionPayload) database.DTEventExecution {
	if p == nil {
		return database.DTEventExecution{}
	}

	exec := database.DTEventExecution{
		UniversalErrorCode: p.UniversalErrorCode,
		ErrorLog:           p.ErrorLog,
		Stdout:             p.Stdout,
		RuntimeMs:          p.RuntimeMs,
		MemoryKb:           p.MemoryKb,
	}

	if p.Tests != nil {
		exec.Tests = database.DTEventTestSummary{
			Total:  p.Tests.Total,
			Passed: p.Tests.Passed,
			Failed: p.Tests.Failed,
		}
	}

	// Cap test results to maxTestResults
	for i, tr := range p.TestResults {
		if i >= maxTestResults {
			break
		}
		exec.TestResults = append(exec.TestResults, database.DTEventTestResult{
			TestName:     tr.TestName,
			Status:       tr.Status,
			Message:      tr.Message,
			ErrorCode:    tr.ErrorCode,
			ErrorTooltip: tr.ErrorTooltip,
		})
	}

	return exec
}

func convertDTVisualization(p *DTVisualizationPayload) database.DTEventVisualization {
	if p == nil {
		return database.DTEventVisualization{}
	}
	return database.DTEventVisualization{
		Kind:          p.Kind,
		MermaidText:   p.MermaidText,
		StateSnapshot: p.StateSnapshot,
	}
}

func convertDTAI(p *DTAIPayload) database.DTEventAI {
	if p == nil {
		return database.DTEventAI{}
	}

	ai := database.DTEventAI{}

	if p.Nano != nil {
		ai.Nano = database.DTEventAINano{
			Enabled:       p.Nano.Enabled,
			PromptVersion: p.Nano.PromptVersion,
			Summary:       p.Nano.Summary,
		}
	}

	if p.Gemini != nil {
		ai.Gemini = database.DTEventAIGemini{
			Enabled:       p.Gemini.Enabled,
			Model:         p.Gemini.Model,
			PromptVersion: p.Gemini.PromptVersion,
			NudgeType:     p.Gemini.NudgeType,
			ResponseText:  p.Gemini.ResponseText,
		}
		for _, lr := range p.Gemini.CitedLineRanges {
			ai.Gemini.CitedLineRanges = append(ai.Gemini.CitedLineRanges, database.DTEventCitedLineRange{
				File:      lr.File,
				StartLine: lr.StartLine,
				EndLine:   lr.EndLine,
			})
		}
	}

	return ai
}

// ============================================================
// Handler: POST /decision-trace/event
// ============================================================

// CreateDecisionTraceEvent records a Run or Submit event in the decision trace timeline.
//
// Steps:
//  1. Authenticate via JWT
//  2. Validate payload
//  3. Get-or-create active session for (user, content, language)
//  4. Check idempotency via browserSubmissionId
//  5. Insert event document
//  6. Update session rolling fields
//  7. If SUBMIT and all tests passed → end session
func CreateDecisionTraceEvent(c echo.Context) error {
	// 1. Auth
	claims, ok := GetUserClaims(c)
	if !ok || claims.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid JWT required",
		})
	}

	// 2. Parse & validate
	var payload DTEventPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	if payload.ContentID == "" || payload.ContentType == "" || payload.Language == "" || payload.EventType == "" || payload.CodeText == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Missing required fields: contentId, contentType, language, eventType, codeText",
		})
	}
	if !validContentTypes[payload.ContentType] {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid contentType. Must be one of: project, problem, module_problem",
		})
	}
	if !validEventTypes[payload.EventType] {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid eventType. Must be one of: RUN, SUBMIT",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	userID := claims.UserID

	// 3. Get or create active session
	session, _, err := database.AppCollections.DecisionTraceSessions.GetOrCreateActiveSession(
		ctx, userID, payload.ContentID, payload.ContentType, payload.Language,
	)
	if err != nil {
		c.Logger().Errorf("DecisionTrace: failed to get/create session: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to get or create session",
		})
	}

	// 4. Idempotency: check if browserSubmissionId already exists
	if payload.BrowserSubmissionID != nil && *payload.BrowserSubmissionID != "" {
		existing, err := database.AppCollections.DecisionTraceEvents.FindEventByBrowserSubmissionID(ctx, *payload.BrowserSubmissionID)
		if err == nil && existing != nil {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"eventId":   existing.ID.Hex(),
				"sessionId": existing.SessionID.Hex(),
				"duplicate": true,
			})
		}
		// If mongo.ErrNoDocuments, proceed with insertion
	}

	// 5. Build event document
	now := time.Now()
	hash := sha256.Sum256([]byte(payload.CodeText))
	codeSHA := fmt.Sprintf("%x", hash)

	event := database.DecisionTraceEventDocument{
		SchemaVersion:       1,
		SessionID:           session.ID,
		UserID:              userID,
		ContentID:           payload.ContentID,
		ContentType:         payload.ContentType,
		Language:            payload.Language,
		EventType:           payload.EventType,
		CreatedAt:           now,
		BrowserSubmissionID: payload.BrowserSubmissionID,
		Code: database.DTEventCode{
			Text:   payload.CodeText,
			SHA256: codeSHA,
		},
		Execution:     convertDTExecution(payload.Execution),
		Visualization: convertDTVisualization(payload.Visualization),
		AI:            convertDTAI(payload.AI),
	}

	// 6. Insert event
	eventID, err := database.AppCollections.DecisionTraceEvents.InsertEvent(ctx, &event)
	if err != nil {
		// Handle duplicate key on browserSubmissionId (race condition)
		if mongo.IsDuplicateKeyError(err) && payload.BrowserSubmissionID != nil {
			existing, findErr := database.AppCollections.DecisionTraceEvents.FindEventByBrowserSubmissionID(ctx, *payload.BrowserSubmissionID)
			if findErr == nil && existing != nil {
				return c.JSON(http.StatusOK, map[string]interface{}{
					"eventId":   existing.ID.Hex(),
					"sessionId": existing.SessionID.Hex(),
					"duplicate": true,
				})
			}
		}
		c.Logger().Errorf("DecisionTrace: failed to insert event: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save event",
		})
	}

	// 7. Update session rolling fields (best-effort; don't fail the request)
	if updateErr := database.AppCollections.DecisionTraceSessions.UpdateSessionRollingFields(
		ctx, session.ID, eventID, now, payload.BrowserSubmissionID,
	); updateErr != nil {
		c.Logger().Errorf("DecisionTrace: failed to update session rolling fields: %v", updateErr)
	}

	// 8. If SUBMIT and all tests passed → end session
	if payload.EventType == "SUBMIT" && allTestsPassed(payload.Execution) {
		if endErr := database.AppCollections.DecisionTraceSessions.EndSession(ctx, session.ID); endErr != nil {
			c.Logger().Errorf("DecisionTrace: failed to end session: %v", endErr)
		}
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"eventId":   eventID.Hex(),
		"sessionId": session.ID.Hex(),
	})
}

// ============================================================
// Handler: GET /decision-trace/session
// ============================================================

// GetDecisionTraceSession returns the active session for a user + content item.
// Query params: contentId, contentType, userId (admin only)
func GetDecisionTraceSession(c echo.Context) error {
	claims, ok := GetUserClaims(c)
	if !ok || claims.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid JWT required",
		})
	}

	contentID := c.QueryParam("contentId")
	contentType := c.QueryParam("contentType")
	if contentID == "" || contentType == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Missing required query params: contentId, contentType",
		})
	}

	// Determine which user's session to look up
	targetUserID := claims.UserID
	if qUserID := c.QueryParam("userId"); qUserID != "" {
		if !isAdminClaims(claims) {
			return c.JSON(http.StatusForbidden, map[string]string{
				"error": "Only admins can view other users' sessions",
			})
		}
		targetUserID = qUserID
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	session, err := database.AppCollections.DecisionTraceSessions.FindActiveSession(ctx, targetUserID, contentID, contentType)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"session": nil,
			})
		}
		c.Logger().Errorf("DecisionTrace: failed to find session: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to find session",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"session": session,
	})
}

// ============================================================
// Handler: GET /decision-trace/timeline
// ============================================================

// GetDecisionTraceTimeline returns minimal event headers for the left-panel timeline.
// Query params: sessionId
func GetDecisionTraceTimeline(c echo.Context) error {
	claims, ok := GetUserClaims(c)
	if !ok || claims.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid JWT required",
		})
	}

	sessionIDHex := c.QueryParam("sessionId")
	if sessionIDHex == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Missing required query param: sessionId",
		})
	}

	sessionID, err := primitive.ObjectIDFromHex(sessionIDHex)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid sessionId format",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Verify ownership (unless admin)
	session, err := database.AppCollections.DecisionTraceSessions.FindSessionByID(ctx, sessionID)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Session not found",
			})
		}
		c.Logger().Errorf("DecisionTrace: failed to find session for timeline: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load session",
		})
	}

	if session.UserID != claims.UserID && !isAdminClaims(claims) {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "Access denied",
		})
	}

	// Fetch timeline entries
	entries, err := database.AppCollections.DecisionTraceEvents.GetTimelineForSession(ctx, sessionID)
	if err != nil {
		c.Logger().Errorf("DecisionTrace: failed to get timeline: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load timeline",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"sessionId": session.ID.Hex(),
		"events":    entries,
	})
}

// ============================================================
// Handler: GET /decision-trace/event
// ============================================================

// GetDecisionTraceEvent returns a full event document for the scrub/detail view.
// Query params: id
func GetDecisionTraceEvent(c echo.Context) error {
	claims, ok := GetUserClaims(c)
	if !ok || claims.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid JWT required",
		})
	}

	eventIDHex := c.QueryParam("id")
	if eventIDHex == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Missing required query param: id",
		})
	}

	eventID, err := primitive.ObjectIDFromHex(eventIDHex)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid event id format",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	event, err := database.AppCollections.DecisionTraceEvents.FindEventByID(ctx, eventID)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusNotFound, map[string]string{
				"error": "Event not found",
			})
		}
		c.Logger().Errorf("DecisionTrace: failed to find event: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to load event",
		})
	}

	// Verify ownership (unless admin)
	if event.UserID != claims.UserID && !isAdminClaims(claims) {
		return c.JSON(http.StatusForbidden, map[string]string{
			"error": "Access denied",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"event": event,
	})
}
