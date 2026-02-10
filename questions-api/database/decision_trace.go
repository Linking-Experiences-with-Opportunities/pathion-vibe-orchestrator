package database

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ============================================================
// Session Document
// ============================================================

// DecisionTraceSessionDocument groups a timeline of Run/Submit events
// for a single user on a single content item (project, problem, or module problem).
type DecisionTraceSessionDocument struct {
	ID                      primitive.ObjectID  `bson:"_id,omitempty" json:"_id"`
	UserID                  string              `bson:"userId" json:"userId"`           // Supabase UUID
	ContentID               string              `bson:"contentId" json:"contentId"`     // project/problem/module ID
	ContentType             string              `bson:"contentType" json:"contentType"` // "project" | "problem" | "module_problem"
	Language                string              `bson:"language" json:"language"`       // "python" | "java" | "cpp" etc.
	Status                  string              `bson:"status" json:"status"`           // "active" | "ended"
	StartedAt               time.Time           `bson:"startedAt" json:"startedAt"`
	EndedAt                 *time.Time          `bson:"endedAt,omitempty" json:"endedAt"`
	SchemaVersion           int                 `bson:"schemaVersion" json:"schemaVersion"`
	LastEventAt             time.Time           `bson:"lastEventAt" json:"lastEventAt"`
	LastEventID             *primitive.ObjectID `bson:"lastEventId,omitempty" json:"lastEventId"`
	TotalEvents             int                 `bson:"totalEvents" json:"totalEvents"`
	LastBrowserSubmissionID *string             `bson:"lastBrowserSubmissionId,omitempty" json:"lastBrowserSubmissionId"`
}

// ============================================================
// Event Document + Sub-Structs
// ============================================================

// DecisionTraceEventDocument stores one Run/Submit event —
// sufficient to render timeline nodes, scrub to the event, and restore code.
type DecisionTraceEventDocument struct {
	ID                  primitive.ObjectID   `bson:"_id,omitempty" json:"_id"`
	SchemaVersion       int                  `bson:"schemaVersion" json:"schemaVersion"`
	SessionID           primitive.ObjectID   `bson:"sessionId" json:"sessionId"`
	UserID              string               `bson:"userId" json:"userId"`
	ContentID           string               `bson:"contentId" json:"contentId"`
	ContentType         string               `bson:"contentType" json:"contentType"`
	Language            string               `bson:"language" json:"language"`
	EventType           string               `bson:"eventType" json:"eventType"` // "RUN" | "SUBMIT"
	CreatedAt           time.Time            `bson:"createdAt" json:"createdAt"`
	BrowserSubmissionID *string              `bson:"browserSubmissionId,omitempty" json:"browserSubmissionId"`
	Code                DTEventCode          `bson:"code" json:"code"`
	Execution           DTEventExecution     `bson:"execution" json:"execution"`
	Visualization       DTEventVisualization `bson:"visualization" json:"visualization"`
	AI                  DTEventAI            `bson:"ai" json:"ai"`
}

// DTEventCode stores the exact code snapshot at Run/Submit time.
type DTEventCode struct {
	Text   string `bson:"text" json:"text"`
	SHA256 string `bson:"sha256" json:"sha256"`
}

// DTEventExecution stores the execution summary for UI rendering.
type DTEventExecution struct {
	UniversalErrorCode *string             `bson:"universalErrorCode,omitempty" json:"universalErrorCode"`
	ErrorLog           *string             `bson:"errorLog,omitempty" json:"errorLog"`
	Stdout             *string             `bson:"stdout,omitempty" json:"stdout"`
	RuntimeMs          *int                `bson:"runtimeMs,omitempty" json:"runtimeMs"`
	MemoryKb           *int                `bson:"memoryKb,omitempty" json:"memoryKb"`
	Tests              DTEventTestSummary  `bson:"tests" json:"tests"`
	TestResults        []DTEventTestResult `bson:"testResults,omitempty" json:"testResults"`
}

// DTEventTestSummary holds pass/fail counts.
type DTEventTestSummary struct {
	Total  *int `bson:"total,omitempty" json:"total"`
	Passed *int `bson:"passed,omitempty" json:"passed"`
	Failed *int `bson:"failed,omitempty" json:"failed"`
}

// DTEventTestResult stores a single test case result (capped to 10 in V1).
type DTEventTestResult struct {
	TestName     string  `bson:"testName" json:"testName"`
	Status       string  `bson:"status" json:"status"` // "passed" | "failed"
	Message      *string `bson:"message,omitempty" json:"message"`
	ErrorCode    *string `bson:"errorCode,omitempty" json:"errorCode"`
	ErrorTooltip *string `bson:"errorTooltip,omitempty" json:"errorTooltip"`
}

// DTEventVisualization holds optional Mermaid visualization and state snapshot.
type DTEventVisualization struct {
	Kind          *string                `bson:"kind,omitempty" json:"kind"` // "MERMAID" | null
	MermaidText   *string                `bson:"mermaidText,omitempty" json:"mermaidText"`
	StateSnapshot map[string]interface{} `bson:"stateSnapshot,omitempty" json:"stateSnapshot,omitempty"`
}

// DTEventAI holds AI artifacts (nano + gemini layers).
type DTEventAI struct {
	Nano   DTEventAINano   `bson:"nano" json:"nano"`
	Gemini DTEventAIGemini `bson:"gemini" json:"gemini"`
}

// DTEventAINano holds the fast/cheap nano-layer output.
type DTEventAINano struct {
	Enabled       bool    `bson:"enabled" json:"enabled"`
	PromptVersion *string `bson:"promptVersion,omitempty" json:"promptVersion"`
	Summary       *string `bson:"summary,omitempty" json:"summary"`
}

// DTEventAIGemini holds the larger-model gemini-layer output.
type DTEventAIGemini struct {
	Enabled         bool                    `bson:"enabled" json:"enabled"`
	Model           *string                 `bson:"model,omitempty" json:"model"`
	PromptVersion   *string                 `bson:"promptVersion,omitempty" json:"promptVersion"`
	NudgeType       *string                 `bson:"nudgeType,omitempty" json:"nudgeType"`
	ResponseText    *string                 `bson:"responseText,omitempty" json:"responseText"`
	CitedLineRanges []DTEventCitedLineRange `bson:"citedLineRanges,omitempty" json:"citedLineRanges"`
}

// DTEventCitedLineRange identifies a line range for highlighting.
type DTEventCitedLineRange struct {
	File      *string `bson:"file,omitempty" json:"file"`
	StartLine int     `bson:"startLine" json:"startLine"`
	EndLine   int     `bson:"endLine" json:"endLine"`
}

// ============================================================
// Timeline Header (minimal projection for GET /decision-trace/timeline)
// ============================================================

// DecisionTraceTimelineEntry is a minimal event summary for the left-panel timeline.
type DecisionTraceTimelineEntry struct {
	EventID            primitive.ObjectID `json:"eventId"`
	CreatedAt          time.Time          `json:"createdAt"`
	EventType          string             `json:"eventType"`
	TestsFailed        *int               `json:"testsFailed"`
	UniversalErrorCode *string            `json:"universalErrorCode"`
}

// ============================================================
// Collection Structs
// ============================================================

// DecisionTraceSessionsCollection handles DB operations for decision_trace_sessions.
type DecisionTraceSessionsCollection struct {
	collection *mongo.Collection
}

// DecisionTraceEventsCollection handles DB operations for decision_trace_events.
type DecisionTraceEventsCollection struct {
	collection *mongo.Collection
}

// ============================================================
// Index Creation
// ============================================================

// EnsureIndexes creates required indexes for decision_trace_sessions.
func (c *DecisionTraceSessionsCollection) EnsureIndexes(ctx context.Context) error {
	indexes := []mongo.IndexModel{
		// 1) Fast lookup for current active session
		{
			Keys: bson.D{
				{Key: "userId", Value: 1},
				{Key: "contentId", Value: 1},
				{Key: "contentType", Value: 1},
				{Key: "status", Value: 1},
				{Key: "lastEventAt", Value: -1},
			},
			Options: options.Index().SetName("idx_sessions_user_content_status_lastEventAt"),
		},
		// 2) Prevent multiple active sessions per (userId, contentId, contentType, language)
		{
			Keys: bson.D{
				{Key: "userId", Value: 1},
				{Key: "contentId", Value: 1},
				{Key: "contentType", Value: 1},
				{Key: "language", Value: 1},
			},
			Options: options.Index().
				SetName("uidx_sessions_one_active_per_user_content_language").
				SetUnique(true).
				SetPartialFilterExpression(bson.M{"status": "active"}),
		},
		// 3) Admin/debugging queries by content
		{
			Keys: bson.D{
				{Key: "contentId", Value: 1},
				{Key: "lastEventAt", Value: -1},
			},
			Options: options.Index().SetName("idx_sessions_content_lastEventAt"),
		},
	}

	_, err := c.collection.Indexes().CreateMany(ctx, indexes)
	return err
}

// EnsureIndexes creates required indexes for decision_trace_events.
func (c *DecisionTraceEventsCollection) EnsureIndexes(ctx context.Context) error {
	indexes := []mongo.IndexModel{
		// 1) Timeline fetch for user+content (fast)
		{
			Keys: bson.D{
				{Key: "userId", Value: 1},
				{Key: "contentId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("idx_events_user_content_createdAt"),
		},
		// 2) Timeline fetch for a session scrub (fast)
		{
			Keys: bson.D{
				{Key: "sessionId", Value: 1},
				{Key: "createdAt", Value: 1},
			},
			Options: options.Index().SetName("idx_events_session_createdAt"),
		},
		// 3) Deduplicate if browserSubmissionId is provided
		{
			Keys: bson.D{
				{Key: "browserSubmissionId", Value: 1},
			},
			Options: options.Index().
				SetName("uidx_events_browserSubmissionId").
				SetUnique(true).
				SetSparse(true),
		},
		// 4) Quick filtering by type within a session
		{
			Keys: bson.D{
				{Key: "sessionId", Value: 1},
				{Key: "eventType", Value: 1},
				{Key: "createdAt", Value: 1},
			},
			Options: options.Index().SetName("idx_events_session_eventType_createdAt"),
		},
	}

	_, err := c.collection.Indexes().CreateMany(ctx, indexes)
	return err
}

// ============================================================
// Session CRUD
// ============================================================

// GetOrCreateActiveSession finds an existing active session or creates a new one.
// Returns (session, created, error).
func (c *DecisionTraceSessionsCollection) GetOrCreateActiveSession(
	ctx context.Context,
	userID, contentID, contentType, language string,
) (*DecisionTraceSessionDocument, bool, error) {
	now := time.Now()

	filter := bson.M{
		"userId":      userID,
		"contentId":   contentID,
		"contentType": contentType,
		"language":    language,
		"status":      "active",
	}

	// Try to find existing active session
	var session DecisionTraceSessionDocument
	err := c.collection.FindOne(ctx, filter).Decode(&session)
	if err == nil {
		return &session, false, nil
	}
	if err != mongo.ErrNoDocuments {
		return nil, false, fmt.Errorf("failed to query active session: %w", err)
	}

	// Create new session
	session = DecisionTraceSessionDocument{
		UserID:        userID,
		ContentID:     contentID,
		ContentType:   contentType,
		Language:      language,
		Status:        "active",
		StartedAt:     now,
		SchemaVersion: 1,
		LastEventAt:   now,
		TotalEvents:   0,
	}

	result, err := c.collection.InsertOne(ctx, session)
	if err != nil {
		// Race condition: another request created the session between FindOne and InsertOne.
		// The partial unique index will produce a duplicate key error. Retry the find.
		if mongo.IsDuplicateKeyError(err) {
			err = c.collection.FindOne(ctx, filter).Decode(&session)
			if err != nil {
				return nil, false, fmt.Errorf("failed to find session after duplicate key: %w", err)
			}
			return &session, false, nil
		}
		return nil, false, fmt.Errorf("failed to create session: %w", err)
	}

	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		session.ID = oid
	}

	return &session, true, nil
}

// FindSessionByID retrieves a session by its ObjectID.
func (c *DecisionTraceSessionsCollection) FindSessionByID(ctx context.Context, sessionID primitive.ObjectID) (*DecisionTraceSessionDocument, error) {
	var session DecisionTraceSessionDocument
	err := c.collection.FindOne(ctx, bson.M{"_id": sessionID}).Decode(&session)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// FindActiveSession finds the active session for a user + content item.
func (c *DecisionTraceSessionsCollection) FindActiveSession(
	ctx context.Context,
	userID, contentID, contentType string,
) (*DecisionTraceSessionDocument, error) {
	filter := bson.M{
		"userId":      userID,
		"contentId":   contentID,
		"contentType": contentType,
		"status":      "active",
	}
	opts := options.FindOne().SetSort(bson.D{{Key: "lastEventAt", Value: -1}})

	var session DecisionTraceSessionDocument
	err := c.collection.FindOne(ctx, filter, opts).Decode(&session)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// UpdateSessionRollingFields bumps session counters and pointers after a new event is inserted.
func (c *DecisionTraceSessionsCollection) UpdateSessionRollingFields(
	ctx context.Context,
	sessionID primitive.ObjectID,
	eventID primitive.ObjectID,
	eventTime time.Time,
	browserSubmissionID *string,
) error {
	setFields := bson.M{
		"lastEventAt": eventTime,
		"lastEventId": eventID,
	}
	if browserSubmissionID != nil {
		setFields["lastBrowserSubmissionId"] = *browserSubmissionID
	}

	update := bson.M{
		"$set": setFields,
		"$inc": bson.M{"totalEvents": 1},
	}

	_, err := c.collection.UpdateByID(ctx, sessionID, update)
	return err
}

// EndSession marks a session as "ended" and sets endedAt.
func (c *DecisionTraceSessionsCollection) EndSession(ctx context.Context, sessionID primitive.ObjectID) error {
	now := time.Now()
	_, err := c.collection.UpdateByID(ctx, sessionID, bson.M{
		"$set": bson.M{
			"status":  "ended",
			"endedAt": now,
		},
	})
	return err
}

// ============================================================
// Event CRUD
// ============================================================

// InsertEvent inserts a new decision trace event document.
func (c *DecisionTraceEventsCollection) InsertEvent(ctx context.Context, event *DecisionTraceEventDocument) (primitive.ObjectID, error) {
	result, err := c.collection.InsertOne(ctx, event)
	if err != nil {
		return primitive.NilObjectID, err
	}
	if oid, ok := result.InsertedID.(primitive.ObjectID); ok {
		return oid, nil
	}
	return primitive.NilObjectID, fmt.Errorf("unexpected inserted ID type")
}

// FindEventByBrowserSubmissionID looks up an event by its browserSubmissionId (for idempotency).
func (c *DecisionTraceEventsCollection) FindEventByBrowserSubmissionID(ctx context.Context, browserSubmissionID string) (*DecisionTraceEventDocument, error) {
	var event DecisionTraceEventDocument
	err := c.collection.FindOne(ctx, bson.M{"browserSubmissionId": browserSubmissionID}).Decode(&event)
	if err != nil {
		return nil, err
	}
	return &event, nil
}

// FindEventByID retrieves a full event document by ObjectID.
func (c *DecisionTraceEventsCollection) FindEventByID(ctx context.Context, eventID primitive.ObjectID) (*DecisionTraceEventDocument, error) {
	var event DecisionTraceEventDocument
	err := c.collection.FindOne(ctx, bson.M{"_id": eventID}).Decode(&event)
	if err != nil {
		return nil, err
	}
	return &event, nil
}

// GetTimelineForSession returns minimal event headers for the timeline UI, sorted by createdAt ASC.
func (c *DecisionTraceEventsCollection) GetTimelineForSession(ctx context.Context, sessionID primitive.ObjectID) ([]DecisionTraceTimelineEntry, error) {
	filter := bson.M{"sessionId": sessionID}
	opts := options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: 1}})

	cursor, err := c.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var entries []DecisionTraceTimelineEntry
	for cursor.Next(ctx) {
		var event DecisionTraceEventDocument
		if err := cursor.Decode(&event); err != nil {
			continue // skip malformed docs
		}
		entries = append(entries, DecisionTraceTimelineEntry{
			EventID:            event.ID,
			CreatedAt:          event.CreatedAt,
			EventType:          event.EventType,
			TestsFailed:        event.Execution.Tests.Failed,
			UniversalErrorCode: event.Execution.UniversalErrorCode,
		})
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	// Return empty slice (not nil) for consistent JSON serialization
	if entries == nil {
		entries = []DecisionTraceTimelineEntry{}
	}

	return entries, nil
}
