package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Custom structs to handle MongoDB export format in JSON
type MongoDate struct {
	Date string `json:"$date"`
}

type LocalSessionArtifactDocument struct {
	ID struct {
		OID string `json:"$oid"`
	} `json:"_id"`
	UserID    string                 `json:"userId"`
	Email     string                 `json:"email"`
	SessionID string                 `json:"sessionId"`
	ProjectID string                 `json:"projectId"`
	Summary   map[string]interface{} `json:"summary"`
	Artifact  map[string]interface{} `json:"artifact"`
	CreatedAt interface{}            `json:"createdAt"` // Handle both string and {$date: ...}
}

func (l *LocalSessionArtifactDocument) ToDB() database.SessionArtifactDocument {
	var t time.Time
	switch v := l.CreatedAt.(type) {
	case string:
		t, _ = time.Parse(time.RFC3339, v)
	case map[string]interface{}:
		if d, ok := v["$date"].(string); ok {
			t, _ = time.Parse(time.RFC3339, d)
		}
	}

	return database.SessionArtifactDocument{
		UserID:    l.UserID,
		Email:     l.Email,
		SessionID: l.SessionID,
		ProjectID: l.ProjectID,
		Summary:   l.Summary,
		Artifact:  l.Artifact,
		CreatedAt: t,
	}
}

// COPY OF PROMPT FROM handlers/report_cards.go
const paragraphSystemPrompt = `You are a rigorous Computer Science professor analyzing a student's coding session logs.
Your goal is to write a "Report Card" paragraph finding patterns in their problem-solving behavior.

Input Data:
You will receive a list of "Session Artifacts". Each artifact represents one coding session and contains:
- Summary: High-level metrics, final outcome, and AI-generated narratives from that session.
- Artifact (optional): Detailed event logs, file snapshots, and test results.

Analysis Instructions:
1. Analyze the *evolution* of their code across runs (if available in Artifact). Did they fix errors logically or guess?
2. Compare the session's automated "narrative" against the raw evidence. If the narrative claims success but the last run failed, note this discrepancy as a "blind spot" or "false confidence".
3. Identify habits:
    - "Brute force" (many runs, small edits) vs. "Deliberate" (few runs, larger edits).
    - "Test tolerance" (do they ignore failing tests?).
    - "Regression" (do they break previously passing tests?).
4. Synthesize a human-readable paragraph (no JSON).
    - Focus on *behavioral* insights, not just "they passed/failed".
    - Be constructive but direct about bad habits.
    - Mention specific examples (e.g., "In the 'Linked List' session, the student repeatedly...").`

// Structs needed for prompt building
type sessionSignals struct {
	SessionCount       int     `json:"sessionCount"`
	FullPassRate       float64 `json:"fullPassRate"`
	AverageRuns        float64 `json:"averageRuns"`
	NarrativeFlagCount int     `json:"narrativeFlagCount"`
}

func main() {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		fmt.Println("Error: GEMINI_API_KEY environment variable not set")
		os.Exit(1)
	}

	// 1. Load Sessions
	sessionsDir := "../.user_sessions" // Assuming running from questions-api root
	abs, _ := filepath.Abs(sessionsDir)
	fmt.Printf("Loading sessions from %s (abs: %s)...\n", sessionsDir, abs)
	if _, err := os.Stat(sessionsDir); os.IsNotExist(err) {
		// Try absolute path if relative fails
		home, _ := os.UserHomeDir()
		sessionsDir = filepath.Join(home, "Github", ".user_sessions")
	}

	fmt.Printf("Loading sessions from %s...\n", sessionsDir)
	sessions, err := loadAllSessions(sessionsDir)
	if err != nil {
		fmt.Printf("Error loading sessions: %v\n", err)
		os.Exit(1)
	}

	if len(sessions) == 0 {
		fmt.Println("No sessions found.")
		os.Exit(0)
	}

	// Filter for a specific user if needed, or just take the first user found
	userID := sessions[0].UserID
	fmt.Printf("Using UserID: %s (found %d total sessions, filtering for this user)\n", userID, len(sessions))

	// REDUCED TO 10 SESSIONS NOW THAT BILLING IS ENABLED
	userSessions := filterAndLimitSessionsByUser(sessions, userID, 10)
	if len(userSessions) == 0 {
		fmt.Println("No sessions found for user.")
		os.Exit(0)
	}
	fmt.Printf("Selected %d recent sessions for analysis.\n", len(userSessions))

	// 2. Build Prompt
	signals := computeSessionSignals(userSessions)
	prompt := buildParagraphPrompt(signals, userSessions, "")

	// 3. Call Gemini
	fmt.Println("Calling Gemini Professor Agent...")
	start := time.Now()
	// Using gemini-3-pro-preview as requested/available
	analysis, err := generateParagraphAnalysis(context.Background(), apiKey, "gemini-3-pro-preview", prompt)
	// Note: using gemini-1.5-pro-latest as it has larger context window for full artifacts
	if err != nil {
		fmt.Printf("Error calling Gemini: %v\n", err)
		os.Exit(1)
	}
	duration := time.Since(start)
	fmt.Printf("Analysis generated in %v.\n", duration)

	// 4. Save Output
	outputFile := ".gemini-professor"
	err = os.WriteFile(outputFile, []byte(analysis), 0644)
	if err != nil {
		fmt.Printf("Error writing output file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Success! Output saved to %s\n", outputFile)
	fmt.Println("---------------------------------------------------")
	fmt.Println(analysis)
	fmt.Println("---------------------------------------------------")
}

// --- Helper Functions (Copied/Adapted from handlers/report_cards.go) ---

func loadAllSessions(sessionsDir string) ([]database.SessionArtifactDocument, error) {
	allPath := filepath.Join(sessionsDir, "all_sessions.json")
	if docs, err := loadSessionsFromFile(allPath); err == nil && len(docs) > 0 {
		return docs, nil
	}

	pattern := filepath.Join(sessionsDir, "session_*.json")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	var all []database.SessionArtifactDocument
	for _, file := range files {
		docs, err := loadSessionsFromFile(file)
		if err != nil {
			continue
		}
		all = append(all, docs...)
	}
	return all, nil
}

func loadSessionsFromFile(filePath string) ([]database.SessionArtifactDocument, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Printf("Failed to read file %s: %v\n", filePath, err)
		return nil, err
	}

	// Try array first
	var localArr []LocalSessionArtifactDocument
	if err := json.Unmarshal(raw, &localArr); err == nil {
		out := make([]database.SessionArtifactDocument, len(localArr))
		for i, l := range localArr {
			out[i] = l.ToDB()
		}
		return out, nil
	}

	// Try single object
	var localOne LocalSessionArtifactDocument
	if err := json.Unmarshal(raw, &localOne); err == nil {
		return []database.SessionArtifactDocument{localOne.ToDB()}, nil
	}

	fmt.Printf("Failed to parse file %s (tried array and single object)\n", filePath)
	return nil, fmt.Errorf("parse error")
}

func filterAndLimitSessionsByUser(in []database.SessionArtifactDocument, userID string, limit int) []database.SessionArtifactDocument {
	out := make([]database.SessionArtifactDocument, 0, len(in))
	for _, s := range in {
		if s.UserID == userID {
			out = append(out, s)
		}
	}
	// Sort by startedAt descending (newest first)
	sort.SliceStable(out, func(i, j int) bool {
		return numFromMap(out[i].Summary, "startedAt") > numFromMap(out[j].Summary, "startedAt")
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
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
	return sessionSignals{
		SessionCount:       sessionCount,
		FullPassRate:       float64(fullPass) / float64(sessionCount),
		AverageRuns:        totalRuns / float64(sessionCount),
		NarrativeFlagCount: narrativeFlags,
	}
}

func buildParagraphPrompt(signals sessionSignals, sessions []database.SessionArtifactDocument, extraContext string) string {
	data := make([]map[string]interface{}, 0, len(sessions))
	for _, s := range sessions {
		item := map[string]interface{}{
			"sessionId": s.SessionID,
			"createdAt": s.CreatedAt,
			"summary":   s.Summary,
			"artifact":  s.Artifact,
		}
		data = append(data, item)
	}

	payload := map[string]interface{}{
		"studentSignals": signals,
		"sessionLogs":    data,
		"context":        extraContext,
	}

	b, _ := json.MarshalIndent(payload, "", "  ")
	return "Analyze these student sessions:\n\n" + string(b)
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
	return strings.TrimSpace(parsed.Candidates[0].Content.Parts[0].Text), nil
}

// Utility functions for map extraction
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
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}

func strFromNestedMap(m map[string]interface{}, key1, key2 string) string {
	if m == nil {
		return ""
	}
	n1, ok := m[key1]
	if !ok || n1 == nil {
		return ""
	}
	nested, ok := n1.(map[string]interface{})
	if !ok {
		// try primitive.M or map[string]any
		if bm, ok := n1.(bson.M); ok {
			nested = map[string]interface{}(bm)
		}
	}
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
	if s, ok := v.([]interface{}); ok {
		return s
	}
	if s, ok := v.(primitive.A); ok {
		return []interface{}(s)
	}
	return nil
}
