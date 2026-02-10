package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

const defaultReportModel = "gemini-3-pro-preview"
const defaultSessionsDir = "../.user_sessions"

const paragraphSystemPrompt = `You are a rigorous Computer Science Professor. 
You are reviewing the work of a student based on "Session Artifacts".
Each artifact contains:
1. "Grader Notes" (narratives): These were written by a Teaching Assistant (TA) LLM immediately after the session. They describe what happened. 
2. "Raw Evidence" (metrics, logs, file snapshots): The ground truth of what actually happened.

Your Goal:
Write a natural language "Report Card" paragraph describing the student's habits, fallbacks, strengths, and risk areas.

Crucial Instruction:
Trust but verify the "Grader Notes". 
- Use them to understand the *intent* and *flow* of the session.
- But VALIDATE them against the Raw Evidence. 
    - Example: If the Grader says "Student successfully implemented X", but the test logs show low pass rates or mostly failed runs, *call this out* as a gap in understanding or false confidence.
    - Example: If the Grader is vague, look at the code snapshots to find the specific "brute force" or "elegant" patterns they missed.

Output Style:
- Direct, second-person ("You tend to..."). 
- Professional but critical.
- Cite specific sessions to back up your claims.`

type reportCardsJobRequest struct {
	Job             string `json:"job"`
	Model           string `json:"model,omitempty"`
	SessionWindow   int64  `json:"sessionWindow,omitempty"`
	ReportID        string `json:"reportId,omitempty"`
	ManualParagraph string `json:"manualParagraph,omitempty"`
	PromptContext   string `json:"promptContext,omitempty"`
	RevisionReason  string `json:"revisionReason,omitempty"`
	Action          string `json:"action,omitempty"` // manage action: list|get|archive
	IncludeArchived bool   `json:"includeArchived,omitempty"`
}

type sessionSignals struct {
	SessionCount       int     `json:"sessionCount"`
	FullPassRate       float64 `json:"fullPassRate"`
	AverageRuns        float64 `json:"averageRuns"`
	NarrativeFlagCount int     `json:"narrativeFlagCount"`
}

// ReportCardsJob handles POST /report-cards/jobs.
// Jobs: create, revise, interpret, manage.
func ReportCardsJob(c echo.Context) error {
	user, ok := GetUserClaims(c)
	if !ok || user.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	var req reportCardsJobRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if req.Job == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "job is required"})
	}

	ctx := c.Request().Context()
	job := strings.ToLower(strings.TrimSpace(req.Job))

	switch job {
	case "create":
		return handleCreateReportCardJob(c, ctx, user.UserID, user.Email, req)
	case "revise":
		return handleReviseReportCardJob(c, ctx, user.UserID, user.Email, req)
	case "interpret":
		return handleInterpretReportCardJob(c, ctx, user.UserID, user.Email, req)
	case "manage":
		return handleManageReportCardJob(c, ctx, user.UserID, user.Email, req)
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Unsupported job"})
	}
}

// GetMyReportCards handles GET /report-cards/me.
func GetMyReportCards(c echo.Context) error {
	user, ok := GetUserClaims(c)
	if !ok || user.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	doc, err := database.GetUserReportCards(c.Request().Context(), user.UserID, user.Email)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusOK, map[string]interface{}{
				"userId":  user.UserID,
				"email":   user.Email,
				"reports": []database.ReportCardEntry{},
			})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to fetch report cards"})
	}
	return c.JSON(http.StatusOK, doc)
}

func handleCreateReportCardJob(c echo.Context, ctx context.Context, userID, email string, req reportCardsJobRequest) error {
	paragraph := strings.TrimSpace(req.ManualParagraph)
	window := req.SessionWindow
	if window <= 0 {
		window = 12
	}

	sessions, err := loadUserSessionsFromDisk(userID, window)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user_sessions"})
	}

	signals := computeSessionSignals(sessions)
	if paragraph == "" {
		apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
		if apiKey == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "manualParagraph is required when GEMINI_API_KEY is not configured"})
		}
		model := req.Model
		if model == "" {
			model = defaultReportModel
		}

		paragraph, err = generateParagraphAnalysis(ctx, apiKey, model, buildParagraphPrompt(signals, sessions, req.PromptContext))
		if err != nil {
			return c.JSON(http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to generate paragraph analysis: %v", err)})
		}
	}

	entry := database.ReportCardEntry{
		ReportID:  randomHexID(),
		Paragraph: paragraph,
		Status:    "active",
		Source: map[string]interface{}{
			"job":              "create",
			"sessionWindow":    window,
			"sessionCountUsed": len(sessions),
			"createdVia": func() string {
				if strings.TrimSpace(req.ManualParagraph) != "" {
					return "manual"
				}
				return "llm"
			}(),
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := database.AppendReportCard(ctx, userID, email, entry); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save report card"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"job":     "create",
		"report":  entry,
		"signals": signals,
	})
}

func handleReviseReportCardJob(c echo.Context, ctx context.Context, userID, email string, req reportCardsJobRequest) error {
	if req.ReportID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "reportId is required"})
	}
	paragraph := strings.TrimSpace(req.ManualParagraph)
	if paragraph == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "manualParagraph is required for revise"})
	}

	updated, err := database.ReviseReportCard(ctx, userID, email, req.ReportID, paragraph, strings.TrimSpace(req.RevisionReason))
	if err != nil {
		if err == mongo.ErrNoDocuments || err == database.ErrReportNotFound {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to revise report"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status": "ok",
		"job":    "revise",
		"report": updated,
	})
}

func handleInterpretReportCardJob(c echo.Context, ctx context.Context, userID, email string, req reportCardsJobRequest) error {
	doc, err := database.GetUserReportCards(ctx, userID, email)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "No report cards found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load report cards"})
	}

	report, ok := pickReportForInterpret(doc.Reports, req.ReportID, req.IncludeArchived)
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
	}

	sessions, err := loadUserSessionsFromDisk(userID, 20)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user_sessions"})
	}
	signals := computeSessionSignals(sessions)

	interpreted := deterministicInterpretReport(*report, signals)
	updated, err := database.SetReportInterpretedCard(ctx, userID, email, report.ReportID, interpreted)
	if err != nil {
		if err == mongo.ErrNoDocuments || err == database.ErrReportNotFound {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save interpreted report"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":      "ok",
		"job":         "interpret",
		"report":      updated,
		"interpreted": interpreted,
	})
}

func handleManageReportCardJob(c echo.Context, ctx context.Context, userID, email string, req reportCardsJobRequest) error {
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action == "" {
		action = "list"
	}

	doc, err := database.GetUserReportCards(ctx, userID, email)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return c.JSON(http.StatusOK, map[string]interface{}{"status": "ok", "job": "manage", "reports": []database.ReportCardEntry{}})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load report cards"})
	}

	switch action {
	case "list":
		reports := make([]database.ReportCardEntry, 0, len(doc.Reports))
		for _, r := range doc.Reports {
			if !req.IncludeArchived && strings.EqualFold(r.Status, "archived") {
				continue
			}
			reports = append(reports, r)
		}
		sort.SliceStable(reports, func(i, j int) bool {
			return reports[i].CreatedAt.After(reports[j].CreatedAt)
		})
		return c.JSON(http.StatusOK, map[string]interface{}{"status": "ok", "job": "manage", "action": "list", "reports": reports})
	case "get":
		if req.ReportID == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "reportId is required for manage:get"})
		}
		for _, r := range doc.Reports {
			if r.ReportID != req.ReportID {
				continue
			}
			if !req.IncludeArchived && strings.EqualFold(r.Status, "archived") {
				return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
			}
			return c.JSON(http.StatusOK, map[string]interface{}{"status": "ok", "job": "manage", "action": "get", "report": r})
		}
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
	case "archive":
		if req.ReportID == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "reportId is required for manage:archive"})
		}
		updated, err := database.SetReportStatus(ctx, userID, email, req.ReportID, "archived")
		if err != nil {
			if err == mongo.ErrNoDocuments || err == database.ErrReportNotFound {
				return c.JSON(http.StatusNotFound, map[string]string{"error": "Report not found"})
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to archive report"})
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"status": "ok", "job": "manage", "action": "archive", "report": updated})
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Unsupported manage action"})
	}
}

func pickReportForInterpret(reports []database.ReportCardEntry, reportID string, includeArchived bool) (*database.ReportCardEntry, bool) {
	if reportID != "" {
		for i := range reports {
			if reports[i].ReportID != reportID {
				continue
			}
			if !includeArchived && strings.EqualFold(reports[i].Status, "archived") {
				return nil, false
			}
			return &reports[i], true
		}
		return nil, false
	}

	if len(reports) == 0 {
		return nil, false
	}
	sorted := make([]database.ReportCardEntry, 0, len(reports))
	for _, r := range reports {
		if !includeArchived && strings.EqualFold(r.Status, "archived") {
			continue
		}
		sorted = append(sorted, r)
	}
	if len(sorted) == 0 {
		return nil, false
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].CreatedAt.After(sorted[j].CreatedAt)
	})
	return &sorted[0], true
}

func computeSessionSignals(sessions []database.SessionArtifactDocument) sessionSignals {
	if len(sessions) == 0 {
		return sessionSignals{}
	}

	totalRuns := 0.0
	fullPass := 0
	narrativeFlags := 0

	for _, s := range sessions {
		runCount := numFromMap(s.Summary, "runCount")
		if runCount == 0 {
			runCount = float64(len(anySliceFromMap(s.Summary, "runOutcomes")))
		}
		totalRuns += runCount

		outcomes := anySliceFromMap(s.Summary, "runOutcomes")
		if len(outcomes) > 0 {
			if last, ok := outcomes[len(outcomes)-1].(map[string]interface{}); ok {
				testsPassed := numFromMap(last, "testsPassed")
				testsTotal := numFromMap(last, "testsTotal")
				if testsTotal > 0 && testsPassed == testsTotal {
					fullPass++
				}
			}
		}

		narrative := strings.ToLower(strings.TrimSpace(strFromNestedMap(s.Summary, "narratives", "narrative")))
		if narrative != "" {
			claimsAllPass := strings.Contains(narrative, "all tests passed") || strings.Contains(narrative, "full pass")
			if claimsAllPass {
				passed := false
				if len(outcomes) > 0 {
					if last, ok := outcomes[len(outcomes)-1].(map[string]interface{}); ok {
						testsPassed := numFromMap(last, "testsPassed")
						testsTotal := numFromMap(last, "testsTotal")
						passed = testsTotal > 0 && testsPassed == testsTotal
					}
				}
				if !passed {
					narrativeFlags++
				}
			}
		}
	}

	sessionCount := len(sessions)
	fullPassRate := float64(fullPass) / float64(sessionCount)
	avgRuns := totalRuns / float64(sessionCount)

	return sessionSignals{
		SessionCount:       sessionCount,
		FullPassRate:       fullPassRate,
		AverageRuns:        avgRuns,
		NarrativeFlagCount: narrativeFlags,
	}
}

// ... (omitted structs are unchanged)

func buildParagraphPrompt(signals sessionSignals, sessions []database.SessionArtifactDocument, extraContext string) string {
	// We want to send the FULL session details to Gemini.
	// We will serialize the entire SessionArtifactDocument (or the relevant parts).
	// To save *some* tokens, we might omit empty fields, but for now, full detail is better.

	data := make([]map[string]interface{}, 0, len(sessions))
	for _, s := range sessions {
		// Construct a clean object for the prompt
		item := map[string]interface{}{
			"sessionId": s.SessionID,
			"projectId": s.ProjectID,
			"createdAt": s.CreatedAt,
			"summary":   s.Summary,
			// Include the full artifact if present.
			// Note: This can be large. If we hit limits, we might need to truncate `testOutput` or file content.
			"artifact": s.Artifact,
		}
		data = append(data, item)
	}

	payload := map[string]interface{}{
		"studentSignals": signals, // comparative stats across all sessions
		"sessionLogs":    data,    // The raw evidence
		"context":        extraContext,
	}

	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		// Fallback if marshalling fails (unlikely)
		return fmt.Sprintf("Error marshalling payload: %v", err)
	}

	return "Analyize these student sessions:\n\n" + string(b)
}

func generateParagraphAnalysis(ctx context.Context, apiKey, model, prompt string) (string, error) {
	endpoint := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		url.PathEscape(model),
		url.QueryEscape(apiKey),
	)
	requestBody := map[string]interface{}{
		"systemInstruction": map[string]interface{}{
			"parts": []map[string]string{{"text": paragraphSystemPrompt}},
		},
		"contents": []map[string]interface{}{
			{
				"role":  "user",
				"parts": []map[string]string{{"text": prompt}},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature": 0.5,
		},
	}
	payloadBytes, _ := json.Marshal(requestBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gemini request failed (%d): %s", resp.StatusCode, string(body))
	}

	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini response missing text")
	}
	text := strings.TrimSpace(parsed.Candidates[0].Content.Parts[0].Text)
	if text == "" {
		return "", fmt.Errorf("gemini returned empty analysis")
	}
	return text, nil
}

func deterministicInterpretReport(report database.ReportCardEntry, signals sessionSignals) database.InterpretedReportCard {
	sentences := splitSentences(report.Paragraph)

	habits := pickSentencesByKeywords(sentences, []string{"habit", "often", "frequently", "typically", "pattern", "tends"}, 3)
	strengths := pickSentencesByKeywords(sentences, []string{"strength", "improve", "improved", "consistent", "stable", "passes", "success"}, 3)
	fallbacks := pickSentencesByKeywords(sentences, []string{"fallback", "retry", "revert", "workaround", "guess", "stuck", "loop"}, 3)
	risks := pickSentencesByKeywords(sentences, []string{"risk", "regress", "failure", "unresolved", "blocked", "thrash", "contradiction"}, 3)
	debugging := pickSentencesByKeywords(sentences, []string{"debug", "error", "trace", "hypothesis", "diagnosis", "test"}, 3)

	if len(habits) == 0 {
		habits = []string{fmt.Sprintf("Average runs per session is %.2f across %d sessions.", signals.AverageRuns, signals.SessionCount)}
	}
	if len(strengths) == 0 {
		strengths = []string{fmt.Sprintf("Full-pass rate is %.0f%% from observed sessions.", signals.FullPassRate*100)}
	}
	if len(fallbacks) == 0 {
		fallbacks = []string{"The paragraph emphasizes repetition patterns when progress stalls."}
	}
	if len(risks) == 0 {
		risks = []string{fmt.Sprintf("Narrative inconsistency flags detected: %d.", signals.NarrativeFlagCount)}
	}
	if len(debugging) == 0 {
		debugging = []string{"Debugging behavior is inferred from run/test iteration patterns in session artifacts."}
	}

	reliability := "high"
	if signals.NarrativeFlagCount > 0 {
		reliability = "medium"
	}
	if signals.NarrativeFlagCount > 2 {
		reliability = "low"
	}

	summary := report.Paragraph
	if len(summary) > 360 {
		summary = summary[:360] + "..."
	}

	return database.InterpretedReportCard{
		Version:              "v1",
		GeneratedAt:          time.Now(),
		Summary:              summary,
		Habits:               habits,
		Strengths:            strengths,
		FallbackPatterns:     fallbacks,
		RiskAreas:            risks,
		DebuggingStyle:       debugging,
		NarrativeReliability: reliability,
		Evidence: database.ReportCardEvidenceStats{
			SessionCount:       signals.SessionCount,
			FullPassRate:       signals.FullPassRate,
			AverageRuns:        signals.AverageRuns,
			NarrativeFlagCount: signals.NarrativeFlagCount,
		},
	}
}

func splitSentences(paragraph string) []string {
	clean := strings.TrimSpace(paragraph)
	if clean == "" {
		return nil
	}
	re := regexp.MustCompile(`[\.!?]+\s+`)
	parts := re.Split(clean, -1)
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s == "" {
			continue
		}
		key := strings.ToLower(s)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, s)
	}
	return out
}

func pickSentencesByKeywords(sentences []string, keywords []string, limit int) []string {
	out := make([]string, 0, limit)
	for _, s := range sentences {
		lower := strings.ToLower(s)
		for _, kw := range keywords {
			if strings.Contains(lower, kw) {
				out = append(out, s)
				break
			}
		}
		if len(out) >= limit {
			break
		}
	}
	return out
}

func numFromMap(m map[string]interface{}, key string) float64 {
	if m == nil {
		return 0
	}
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case uint:
		return float64(n)
	case uint32:
		return float64(n)
	case uint64:
		return float64(n)
	default:
		return 0
	}
}

func strFromMap(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func strFromNestedMap(m map[string]interface{}, key1, key2 string) string {
	if m == nil {
		return ""
	}
	n1, ok := m[key1]
	if !ok || n1 == nil {
		return ""
	}
	nested := anyToStringMap(n1)
	if nested == nil {
		return ""
	}
	v, ok := nested[key2]
	if !ok || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func anySliceFromMap(m map[string]interface{}, key string) []interface{} {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch s := v.(type) {
	case []interface{}:
		return s
	case primitive.A:
		return []interface{}(s)
	default:
		return nil
	}
}

func anyToStringMap(v interface{}) map[string]interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		return t
	case bson.M:
		return map[string]interface{}(t)
	default:
		return nil
	}
}

func loadUserSessionsFromDisk(userID string, limit int64) ([]database.SessionArtifactDocument, error) {
	sessionsDir := strings.TrimSpace(os.Getenv("REPORT_CARDS_SESSIONS_DIR"))
	if sessionsDir == "" {
		sessionsDir = defaultSessionsDir
	}

	allPath := filepath.Join(sessionsDir, "all_sessions.json")
	if docs, err := loadSessionsFromFile(allPath); err == nil && len(docs) > 0 {
		return filterAndLimitSessionsByUser(docs, userID, limit), nil
	}

	pattern := filepath.Join(sessionsDir, "session_*.json")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return []database.SessionArtifactDocument{}, nil
	}

	all := make([]database.SessionArtifactDocument, 0, len(files))
	for _, file := range files {
		docs, err := loadSessionsFromFile(file)
		if err != nil {
			continue
		}
		all = append(all, docs...)
	}
	return filterAndLimitSessionsByUser(all, userID, limit), nil
}

func loadSessionsFromFile(filePath string) ([]database.SessionArtifactDocument, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	var arr []database.SessionArtifactDocument
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}
	var one database.SessionArtifactDocument
	if err := json.Unmarshal(raw, &one); err != nil {
		return nil, err
	}
	return []database.SessionArtifactDocument{one}, nil
}

func filterAndLimitSessionsByUser(in []database.SessionArtifactDocument, userID string, limit int64) []database.SessionArtifactDocument {
	out := make([]database.SessionArtifactDocument, 0, len(in))
	for _, s := range in {
		if s.UserID == userID {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return numFromMap(out[i].Summary, "startedAt") > numFromMap(out[j].Summary, "startedAt")
	})
	if limit > 0 && int64(len(out)) > limit {
		out = out[:limit]
	}
	return out
}

func randomHexID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "rpt_" + primitive.NewObjectID().Hex()
	}
	return fmt.Sprintf("rpt_%s%x", primitive.NewObjectID().Hex(), b)
}
