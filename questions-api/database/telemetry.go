package database

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// TelemetryCollection wraps MongoDB operations for telemetry/runner events
type TelemetryCollection struct {
	collection *mongo.Collection
}

// GetTelemetryCollection returns the telemetry collection from app DB
func GetTelemetryCollection() *TelemetryCollection {
	return &TelemetryCollection{
		collection: GetAppDb().Collection("runner_events"),
	}
}

// GetBrowserSubmissionsCollection returns the browser submissions collection from app DB
func GetBrowserSubmissionsCollection() *mongo.Collection {
	return GetAppDb().Collection("browser_submissions")
}

// GetEventsByUser retrieves telemetry events for a specific user
func (tc *TelemetryCollection) GetEventsByUser(ctx context.Context, userID string, eventType string) ([]RunnerEventDocument, error) {
	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userID},
			{"userId": userID},
		},
	}
	if eventType != "" {
		filter["event"] = eventType
	}

	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})
	cursor, err := tc.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var events []RunnerEventDocument
	if err := cursor.All(ctx, &events); err != nil {
		return nil, err
	}
	return events, nil
}

// GetEventsByUserAndProject retrieves telemetry events for a user on a specific project
func (tc *TelemetryCollection) GetEventsByUserAndProject(ctx context.Context, userID string, projectID string, eventType string) ([]RunnerEventDocument, error) {
	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userID},
			{"userId": userID},
		},
		"properties.projectId": projectID,
	}
	if eventType != "" {
		filter["event"] = eventType
	}

	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}) // Ascending order for chronological processing
	cursor, err := tc.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var events []RunnerEventDocument
	if err := cursor.All(ctx, &events); err != nil {
		return nil, err
	}
	return events, nil
}

// GetDistinctUsersSince returns count of unique users who have created events since the given time
// Handles both old format (Unix milliseconds as int64) and new format (MongoDB Date)
func (tc *TelemetryCollection) GetDistinctUsersSince(ctx context.Context, since time.Time, excludedSupabaseUserIDs []string) (int, error) {
	sinceMs := since.UnixMilli()

	// Query supports both formats: Unix milliseconds (old) and Date (new)
	timeFilter := bson.M{
		"$or": []bson.M{
			{"createdAt": bson.M{"$gte": sinceMs}}, // Old format: Unix ms
			{"createdAt": bson.M{"$gte": since}},   // New format: Date
		},
	}

	// Base filter
	filter := bson.M{
		"$and": []bson.M{
			timeFilter,
			{"userId": bson.M{"$exists": true, "$ne": ""}},
		},
	}

	// Apply exclusion if provided - exclude if EITHER userId or supabaseUserId matches
	if len(excludedSupabaseUserIDs) > 0 {
		filter["$and"] = append(filter["$and"].([]bson.M), bson.M{
			"$nor": []bson.M{
				{"userId": bson.M{"$in": excludedSupabaseUserIDs}},
				{"supabaseUserId": bson.M{"$in": excludedSupabaseUserIDs}},
			},
		})
	}

	users, err := tc.collection.Distinct(ctx, "userId", filter)
	if err != nil {
		return 0, err
	}
	return len(users), nil
}

// GetDistinctUsersInRange returns count of unique active users in a time range
// Handles both old format (Unix milliseconds as int64) and new format (MongoDB Date)
func (tc *TelemetryCollection) GetDistinctUsersInRange(ctx context.Context, start time.Time, end time.Time, excludedSupabaseUserIDs []string) (int, error) {
	startMs := start.UnixMilli()
	endMs := end.UnixMilli()

	// Query supports both formats: Unix milliseconds (old) and Date (new)
	timeFilter := bson.M{
		"$or": []bson.M{
			{"createdAt": bson.M{"$gte": startMs, "$lt": endMs}}, // Old format: Unix ms
			{"createdAt": bson.M{"$gte": start, "$lt": end}},     // New format: Date
		},
	}

	filter := bson.M{
		"$and": []bson.M{
			timeFilter,
			{"userId": bson.M{"$exists": true, "$ne": ""}},
		},
	}

	if len(excludedSupabaseUserIDs) > 0 {
		filter["$and"] = append(filter["$and"].([]bson.M), bson.M{
			"supabaseUserId": bson.M{"$nin": excludedSupabaseUserIDs},
		})
	}

	users, err := tc.collection.Distinct(ctx, "userId", filter)
	if err != nil {
		return 0, err
	}
	return len(users), nil
}

// GetSubmissionsByUser retrieves browser submissions for a specific user
// Matches on emailNormalized, email, or userId for backwards compatibility
func GetSubmissionsByUser(ctx context.Context, userIdentifier string, sourceType string, limit int) ([]BrowserSubmissionDocument, error) {
	collection := GetBrowserSubmissionsCollection()

	// Normalize the identifier for email matching
	normalizedIdentifier := strings.ToLower(strings.TrimSpace(userIdentifier))

	// Match on multiple fields for backwards compatibility + new SupabaseUserID
	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userIdentifier},
			{"emailNormalized": normalizedIdentifier},
			{"email": userIdentifier},
			{"userId": userIdentifier},
		},
	}
	if sourceType != "" {
		filter["sourceType"] = sourceType
	}

	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})
	if limit > 0 {
		opts.SetLimit(int64(limit))
	}

	cursor, err := collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}
	return submissions, nil
}

// GetUniqueProjectIDsByUser returns unique project IDs the user has submissions for
// Matches on emailNormalized, email, or userId for backwards compatibility
func GetUniqueProjectIDsByUser(ctx context.Context, userIdentifier string) ([]string, error) {
	collection := GetBrowserSubmissionsCollection()

	normalizedIdentifier := strings.ToLower(strings.TrimSpace(userIdentifier))

	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userIdentifier},
			{"emailNormalized": normalizedIdentifier},
			{"email": userIdentifier},
			{"userId": userIdentifier},
		},
		"sourceType": "project",
	}

	projectIDs, err := collection.Distinct(ctx, "problemId", filter)
	if err != nil {
		return nil, err
	}

	// Convert []interface{} to []string
	result := make([]string, 0, len(projectIDs))
	for _, id := range projectIDs {
		if strID, ok := id.(string); ok {
			result = append(result, strID)
		}
	}
	return result, nil
}

// GetCompletedProjectIDsByUser returns project IDs where user has passed all tests
// Matches on emailNormalized, email, or userId for backwards compatibility
func GetCompletedProjectIDsByUser(ctx context.Context, userIdentifier string) ([]string, error) {
	collection := GetBrowserSubmissionsCollection()

	normalizedIdentifier := strings.ToLower(strings.TrimSpace(userIdentifier))

	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userIdentifier},
			{"emailNormalized": normalizedIdentifier},
			{"email": userIdentifier},
			{"userId": userIdentifier},
		},
		"sourceType": "project",
		"passed":     true,
	}

	projectIDs, err := collection.Distinct(ctx, "problemId", filter)
	if err != nil {
		return nil, err
	}

	// Convert []interface{} to []string
	result := make([]string, 0, len(projectIDs))
	for _, id := range projectIDs {
		if strID, ok := id.(string); ok {
			result = append(result, strID)
		}
	}
	return result, nil
}

// GetSubmissionsByUserAndProject gets all submissions for a specific user and project
// Matches on emailNormalized, email, or userId for backwards compatibility
func GetSubmissionsByUserAndProject(ctx context.Context, userIdentifier string, projectID string) ([]BrowserSubmissionDocument, error) {
	collection := GetBrowserSubmissionsCollection()

	normalizedIdentifier := strings.ToLower(strings.TrimSpace(userIdentifier))

	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userIdentifier},
			{"emailNormalized": normalizedIdentifier},
			{"email": userIdentifier},
			{"userId": userIdentifier},
		},
		"problemId":  projectID,
		"sourceType": "project",
	}

	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}) // Ascending for chronological order
	cursor, err := collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}
	return submissions, nil
}

// CountSubmissionsByUser counts total submissions for a user
func CountSubmissionsByUser(ctx context.Context, userID string, sourceType string) (int64, error) {
	collection := GetBrowserSubmissionsCollection()

	filter := bson.M{"userId": userID}
	if sourceType != "" {
		filter["sourceType"] = sourceType
	}

	count, err := collection.CountDocuments(ctx, filter)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetProjectTitle retrieves the title of a project by its projectNumber (as string)
func GetProjectTitle(ctx context.Context, projectIDStr string) string {
	// ProjectIDStr could be the projectNumber as string like "7"
	// Try to parse it and get the project
	project, err := ContentCollections.Projects.GetProjectByNumber(ctx, parseIntOrZero(projectIDStr))
	if err != nil || project == nil {
		return "Unknown Project"
	}
	return project.Title
}

// Helper function to parse string to int, returns 0 if invalid
func parseIntOrZero(s string) int {
	var result int
	_, _ = fmt.Sscanf(s, "%d", &result)
	return result
}

// CreateIndexes creates indexes for optimal query performance
func CreateTelemetryIndexes(ctx context.Context) error {
	collection := GetAppDb().Collection("runner_events")

	indexes := []mongo.IndexModel{
		{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "supabaseUserId", Value: 1}, {Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "event", Value: 1}, {Key: "userId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "event", Value: 1}, {Key: "supabaseUserId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "properties.projectId", Value: 1}, {Key: "userId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "properties.projectId", Value: 1}, {Key: "supabaseUserId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "environment", Value: 1}, {Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "environment", Value: 1}, {Key: "supabaseUserId", Value: 1}, {Key: "createdAt", Value: -1}},
		},
	}

	_, err := collection.Indexes().CreateMany(ctx, indexes)
	return err
}

// CreateSubmissionIndexes creates indexes for browser_submissions
func CreateSubmissionIndexes(ctx context.Context) error {
	collection := GetAppDb().Collection("browser_submissions")

	indexes := []mongo.IndexModel{
		{
			Keys: bson.D{{Key: "userId", Value: 1}, {Key: "sourceType", Value: 1}, {Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "supabaseUserId", Value: 1}, {Key: "sourceType", Value: 1}, {Key: "createdAt", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "problemId", Value: 1}, {Key: "userId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "problemId", Value: 1}, {Key: "supabaseUserId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "result.durationMs", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "problemId", Value: 1}, {Key: "result.durationMs", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "result.ttfrMs", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "problemId", Value: 1}, {Key: "result.ttfrMs", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "environment", Value: 1}, {Key: "supabaseUserId", Value: 1}, {Key: "createdAt", Value: -1}},
		},
	}

	_, err := collection.Indexes().CreateMany(ctx, indexes)
	return err
}

// CreateBrowserAnalyticsIndexes creates indexes for browser/device analytics
func CreateBrowserAnalyticsIndexes(ctx context.Context) error {
	collection := GetAppDb().Collection("runner_events")

	indexes := []mongo.IndexModel{
		{
			Keys: bson.D{{Key: "properties.browser", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "properties.os", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "properties.deviceType", Value: 1}},
		},
	}

	_, err := collection.Indexes().CreateMany(ctx, indexes)
	return err
}

// GetLatestTelemetryForUser gets the most recent telemetry event for a user
func (tc *TelemetryCollection) GetLatestTelemetryForUser(ctx context.Context, userID string) (*RunnerEventDocument, error) {
	opts := options.FindOne().SetSort(bson.D{{Key: "createdAt", Value: -1}})

	var event RunnerEventDocument
	err := tc.collection.FindOne(ctx, bson.M{"userId": userID}, opts).Decode(&event)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, err
	}
	return &event, nil
}

// GetAllSubmissionsWithExecutionTime gets all submissions that have execution time data
func GetAllSubmissionsWithExecutionTime(ctx context.Context) ([]BrowserSubmissionDocument, error) {
	collection := GetBrowserSubmissionsCollection()

	filter := bson.M{
		"$or": []bson.M{
			{"result.durationMs": bson.M{"$exists": true, "$gt": 0}},
			{"result.ttfrMs": bson.M{"$exists": true, "$gt": 0}},
		},
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}
	return submissions, nil
}

// GetSubmissionsWithExecutionTimeByProject gets submissions with execution time for a specific project
func GetSubmissionsWithExecutionTimeByProject(ctx context.Context, projectID string) ([]BrowserSubmissionDocument, error) {
	collection := GetBrowserSubmissionsCollection()

	filter := bson.M{
		"problemId": projectID,
		"$or": []bson.M{
			{"result.durationMs": bson.M{"$gt": 0}},
			{"result.ttfrMs": bson.M{"$gt": 0}},
		},
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}
	return submissions, nil
}

// GetSubmissionsWithExecutionTimeByUserAndProject gets submissions with execution time for a user on a specific project
// Matches on emailNormalized, email, or userId for backwards compatibility
func GetSubmissionsWithExecutionTimeByUserAndProject(ctx context.Context, userIdentifier string, projectID string) ([]BrowserSubmissionDocument, error) {
	collection := GetBrowserSubmissionsCollection()

	normalizedIdentifier := strings.ToLower(strings.TrimSpace(userIdentifier))

	filter := bson.M{
		"$or": []bson.M{
			{"supabaseUserId": userIdentifier},
			{"emailNormalized": normalizedIdentifier},
			{"email": userIdentifier},
			{"userId": userIdentifier},
		},
		"problemId":         projectID,
		"result.durationMs": bson.M{"$gt": 0},
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var submissions []BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return nil, err
	}
	return submissions, nil
}

// CountDistinctUsersWithSubmissions returns count of unique users who have submitted at least one project
func CountDistinctUsersWithSubmissions(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	collection := GetBrowserSubmissionsCollection()

	filter := bson.M{
		"sourceType": "project",
		"userId":     bson.M{"$exists": true, "$ne": ""},
	}

	// Exclude if EITHER userId or supabaseUserId matches the excluded list
	if len(excludedSupabaseUserIDs) > 0 {
		filter["$nor"] = []bson.M{
			{"userId": bson.M{"$in": excludedSupabaseUserIDs}},
			{"supabaseUserId": bson.M{"$in": excludedSupabaseUserIDs}},
		}
	}

	userIds, err := collection.Distinct(ctx, "userId", filter)
	if err != nil {
		return 0, err
	}
	return len(userIds), nil
}

// CountDistinctUsersWithCompletedProjects returns count of unique users who have passed at least one project
func CountDistinctUsersWithCompletedProjects(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	collection := GetBrowserSubmissionsCollection()

	filter := bson.M{
		"sourceType": "project",
		"passed":     true,
		"userId":     bson.M{"$exists": true, "$ne": ""},
	}

	// Exclude if EITHER userId or supabaseUserId matches the excluded list
	if len(excludedSupabaseUserIDs) > 0 {
		filter["$nor"] = []bson.M{
			{"userId": bson.M{"$in": excludedSupabaseUserIDs}},
			{"supabaseUserId": bson.M{"$in": excludedSupabaseUserIDs}},
		}
	}

	userIds, err := collection.Distinct(ctx, "userId", filter)
	if err != nil {
		return 0, err
	}
	return len(userIds), nil
}

// CountUsersWhoRanWarmup returns count of unique users who ran code on Project 0 (warmup)
// Uses telemetry events: project_run_attempt where projectId equals "0" (projectNumber as string)
func CountUsersWhoRanWarmup(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	telemetryCol := GetTelemetryCollection()

	// IMPORTANT: projectId in telemetry is the projectNumber as a STRING (e.g., "0", "1", "7")
	// Same pattern as problemId in submissions
	log.Printf("[DEBUG] CountUsersWhoRanWarmup: Querying for projectId='0'")

	// Query telemetry by projectId string
	filter := bson.M{
		"event":                "project_run_attempt",
		"properties.projectId": "0", // Project 0 (warmup)
		"userId":               bson.M{"$exists": true, "$ne": ""},
	}

	if len(excludedSupabaseUserIDs) > 0 {
		filter["userId"] = bson.M{"$nin": excludedSupabaseUserIDs, "$exists": true, "$ne": ""}
	}

	log.Printf("[DEBUG] CountUsersWhoRanWarmup: Query filter = %+v", filter)

	userIds, err := telemetryCol.collection.Distinct(ctx, "userId", filter)
	if err != nil {
		log.Printf("[DEBUG] CountUsersWhoRanWarmup: Distinct query error: %v", err)
		return 0, err
	}
	log.Printf("[DEBUG] CountUsersWhoRanWarmup: Found %d distinct users", len(userIds))
	return len(userIds), nil
}

// CountUsersWhoSubmittedWarmup returns count of unique users who submitted Project 0 (warmup)
// Uses browser_submissions joined with projects where projectNumber=0
func CountUsersWhoSubmittedWarmup(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	return countUsersWithSubmissionsByProjectNumber(ctx, excludedSupabaseUserIDs, 0, false)
}

// CountUsersWhoEnteredCurriculum returns count of unique users who ran code on any real project (projectNumber >= 1)
// Uses telemetry events: project_run_attempt where projectId matches any real project
func CountUsersWhoEnteredCurriculum(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	telemetryCol := GetTelemetryCollection()
	projectsCol := GetContentDb().Collection("projects")

	// First find all real project numbers (projectNumber >= 1)
	cursor, err := projectsCol.Find(ctx, bson.M{"projectNumber": bson.M{"$gte": 1}})
	if err != nil {
		return 0, err
	}
	defer cursor.Close(ctx)

	// IMPORTANT: projectId in telemetry is the projectNumber as a STRING (e.g., "1", "2", "7")
	// Same pattern as problemId in submissions
	var projectIDs []string
	for cursor.Next(ctx) {
		var doc struct {
			ProjectNumber int `bson:"projectNumber"`
		}
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		// Convert projectNumber to string to match projectId format in telemetry
		projectIDs = append(projectIDs, fmt.Sprintf("%d", doc.ProjectNumber))
	}

	log.Printf("[DEBUG] CountUsersWhoEnteredCurriculum: Found %d project IDs: %v", len(projectIDs), projectIDs)

	if len(projectIDs) == 0 {
		return 0, nil
	}

	// Query telemetry by projectId strings
	filter := bson.M{
		"event":                "project_run_attempt",
		"properties.projectId": bson.M{"$in": projectIDs},
		"userId":               bson.M{"$exists": true, "$ne": ""},
	}

	if len(excludedSupabaseUserIDs) > 0 {
		filter["userId"] = bson.M{"$nin": excludedSupabaseUserIDs, "$exists": true, "$ne": ""}
	}

	userIds, err := telemetryCol.collection.Distinct(ctx, "userId", filter)
	if err != nil {
		return 0, err
	}
	return len(userIds), nil
}

// CountDistinctActivatedUsers returns count of unique users who submitted at least one REAL project (projectNumber >= 1)
// This excludes Project Zero (warmup) submissions and represents true "activation"
func CountDistinctActivatedUsers(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	return countUsersWithSubmissionsByProjectNumber(ctx, excludedSupabaseUserIDs, 1, false)
}

// CountDistinctCompletedRealProjects returns count of unique users who PASSED at least one real project (projectNumber >= 1)
func CountDistinctCompletedRealProjects(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	return countUsersWithSubmissionsByProjectNumber(ctx, excludedSupabaseUserIDs, 1, true)
}

// CountRetainedActivatedUsers returns count of activated users who returned (>1 distinct session day)
// An "activated" user is one who submitted a real project (projectNumber >= 1)
// "Retained" means they have telemetry activity on more than 1 distinct calendar day
func CountRetainedActivatedUsers(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	collection := GetBrowserSubmissionsCollection()

	// First, get all activated user IDs (users who submitted projectNumber >= 1)
	activatedUserIDs, err := getActivatedUserIDs(ctx, excludedSupabaseUserIDs)
	if err != nil {
		return 0, err
	}

	if len(activatedUserIDs) == 0 {
		return 0, nil
	}

	// Now count how many of these users have submissions on >1 distinct day
	// NOTE: Use userId (not supabaseUserId) since supabaseUserId is optional
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"sourceType": "project",
			"userId":     bson.M{"$in": activatedUserIDs},
		}}},
		{{Key: "$project", Value: bson.M{
			"userId": 1,
			"dayStr": bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$createdAt"}},
		}}},
		{{Key: "$group", Value: bson.M{
			"_id":          "$userId",
			"distinctDays": bson.M{"$addToSet": "$dayStr"},
		}}},
		{{Key: "$project", Value: bson.M{
			"_id":      1,
			"dayCount": bson.M{"$size": "$distinctDays"},
		}}},
		{{Key: "$match", Value: bson.M{
			"dayCount": bson.M{"$gt": 1}, // More than 1 distinct day
		}}},
		{{Key: "$count", Value: "total"}},
	}

	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return 0, err
	}
	defer cursor.Close(ctx)

	var results []struct {
		Total int `bson:"total"`
	}
	if err := cursor.All(ctx, &results); err != nil {
		return 0, err
	}

	if len(results) == 0 {
		return 0, nil
	}
	return results[0].Total, nil
}

// Helper: Get list of activated user IDs (users who submitted projectNumber >= 1)
func getActivatedUserIDs(ctx context.Context, excludedSupabaseUserIDs []string) ([]string, error) {
	collection := GetBrowserSubmissionsCollection()
	projectsCol := GetContentDb().Collection("projects")

	// Get all projectNumbers where projectNumber >= 1
	projectFilter := bson.M{"projectNumber": bson.M{"$gte": 1}}
	cursor, err := projectsCol.Find(ctx, projectFilter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	// IMPORTANT: problemId in browser_submissions is the projectNumber as a STRING
	// (e.g., "1", "2", "7"), NOT the MongoDB ObjectID!
	var problemIDs []string
	for cursor.Next(ctx) {
		var doc struct {
			ProjectNumber int `bson:"projectNumber"`
		}
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		// Convert projectNumber to string to match problemId format in submissions
		problemIDs = append(problemIDs, fmt.Sprintf("%d", doc.ProjectNumber))
	}

	if len(problemIDs) == 0 {
		return nil, nil
	}

	// Now get distinct users from submissions matching these problem IDs
	// NOTE: Use userId (not supabaseUserId) since supabaseUserId is optional
	submissionFilter := bson.M{
		"sourceType": "project",
		"problemId":  bson.M{"$in": problemIDs},
		"userId":     bson.M{"$exists": true, "$ne": ""},
	}

	// Exclude internal users - check both userId and supabaseUserId
	// Use $nor to exclude if EITHER field matches the excluded list
	if len(excludedSupabaseUserIDs) > 0 {
		submissionFilter["$nor"] = []bson.M{
			{"userId": bson.M{"$in": excludedSupabaseUserIDs}},
			{"supabaseUserId": bson.M{"$in": excludedSupabaseUserIDs}},
		}
	}

	// Use userId for distinct count (always present)
	userIds, err := collection.Distinct(ctx, "userId", submissionFilter)
	if err != nil {
		return nil, err
	}

	// Convert to string slice
	result := make([]string, 0, len(userIds))
	for _, id := range userIds {
		if str, ok := id.(string); ok && str != "" {
			result = append(result, str)
		}
	}
	return result, nil
}

// Helper: Count users with submissions by project number threshold
// minProjectNumber: 0 for warmup, 1 for real projects
// requirePassed: if true, only count passed submissions
func countUsersWithSubmissionsByProjectNumber(ctx context.Context, excludedSupabaseUserIDs []string, minProjectNumber int, requirePassed bool) (int, error) {
	collection := GetBrowserSubmissionsCollection()
	projectsCol := GetContentDb().Collection("projects")

	log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: minProjectNumber=%d, requirePassed=%v", minProjectNumber, requirePassed)

	// First, get all projectNumbers matching the criteria
	var projectFilter bson.M
	if minProjectNumber == 0 {
		projectFilter = bson.M{"projectNumber": 0}
	} else {
		projectFilter = bson.M{"projectNumber": bson.M{"$gte": minProjectNumber}}
	}

	cursor, err := projectsCol.Find(ctx, projectFilter)
	if err != nil {
		log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: Find error: %v", err)
		return 0, err
	}
	defer cursor.Close(ctx)

	// IMPORTANT: problemId in browser_submissions is the projectNumber as a STRING
	// (e.g., "0", "1", "7"), NOT the MongoDB ObjectID!
	var problemIDs []string
	for cursor.Next(ctx) {
		var doc struct {
			ProjectNumber int `bson:"projectNumber"`
		}
		if err := cursor.Decode(&doc); err != nil {
			log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: Decode error: %v", err)
			continue
		}
		// Convert projectNumber to string to match problemId format in submissions
		problemIDs = append(problemIDs, fmt.Sprintf("%d", doc.ProjectNumber))
	}

	log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: Found %d problemIDs: %v", len(problemIDs), problemIDs)

	if len(problemIDs) == 0 {
		log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: No problemIDs found, returning 0")
		return 0, nil
	}

	// Now count distinct users from submissions matching these problem IDs
	// NOTE: Use userId (not supabaseUserId) since supabaseUserId is optional (omitempty)
	submissionFilter := bson.M{
		"sourceType": "project",
		"problemId":  bson.M{"$in": problemIDs},
		"userId":     bson.M{"$exists": true, "$ne": ""},
	}

	if requirePassed {
		submissionFilter["passed"] = true
	}

	// Exclude internal users - check both userId and supabaseUserId
	// Use $nor to exclude if EITHER field matches the excluded list
	if len(excludedSupabaseUserIDs) > 0 {
		submissionFilter["$nor"] = []bson.M{
			{"userId": bson.M{"$in": excludedSupabaseUserIDs}},
			{"supabaseUserId": bson.M{"$in": excludedSupabaseUserIDs}},
		}
	}

	log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: submissionFilter=%+v", submissionFilter)

	// Count distinct by userId (which is always present)
	userIds, err := collection.Distinct(ctx, "userId", submissionFilter)
	if err != nil {
		log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: Distinct error: %v", err)
		return 0, err
	}

	log.Printf("[DEBUG] countUsersWithSubmissionsByProjectNumber: Found %d distinct users", len(userIds))

	return len(userIds), nil
}

// GetAllTelemetryWithBrowserInfo gets all telemetry events that contain browser information
func (tc *TelemetryCollection) GetAllTelemetryWithBrowserInfo(ctx context.Context) ([]RunnerEventDocument, error) {
	filter := bson.M{
		"properties.browser": bson.M{"$exists": true},
	}

	cursor, err := tc.collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var events []RunnerEventDocument
	if err := cursor.All(ctx, &events); err != nil {
		return nil, err
	}
	return events, nil
}

// GetCompletedProjectCountsByUserIDs returns a map of supabaseUserId -> count of unique completed projects.
// Uses a single MongoDB aggregation to efficiently compute progress for multiple users at once.
// This is used by /admin/roster to eliminate N+1 queries for user progress.
//
// Aggregation logic:
// 1. Match: filter to passed project submissions for the given UUIDs
// 2. Group by supabaseUserId, collecting unique problemIds into a set
// 3. Project the count of unique projects as projectsCompleted
func GetCompletedProjectCountsByUserIDs(ctx context.Context, userIDs []string) (map[string]int, error) {
	if len(userIDs) == 0 {
		return make(map[string]int), nil
	}

	collection := GetBrowserSubmissionsCollection()

	// MongoDB aggregation pipeline:
	// Stage 1: Match submissions that are projects, passed, and belong to the given users
	// Stage 2: Group by supabaseUserId, collecting unique problemIds
	// Stage 3: Project the count of unique projects
	pipeline := mongo.Pipeline{
		// Match: filter to relevant submissions
		// Note: Supabase UUID is stored in "userId" field, not "supabaseUserId"
		{{Key: "$match", Value: bson.M{
			"userId":     bson.M{"$in": userIDs},
			"sourceType": "project",
			"passed":     true,
		}}},
		// Group by user, collect unique project IDs
		{{Key: "$group", Value: bson.M{
			"_id":        "$userId",
			"projectSet": bson.M{"$addToSet": "$problemId"},
		}}},
		// Project the count of unique projects
		{{Key: "$project", Value: bson.M{
			"_id":               1,
			"projectsCompleted": bson.M{"$size": "$projectSet"},
		}}},
	}

	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregation failed: %w", err)
	}
	defer cursor.Close(ctx)

	// Parse results into a map
	result := make(map[string]int)
	for cursor.Next(ctx) {
		var doc struct {
			ID                string `bson:"_id"`
			ProjectsCompleted int    `bson:"projectsCompleted"`
		}
		if err := cursor.Decode(&doc); err != nil {
			return nil, fmt.Errorf("failed to decode aggregation result: %w", err)
		}
		result[doc.ID] = doc.ProjectsCompleted
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	return result, nil
}

// GetPassRatesByUserIDs returns a map of supabaseUserId -> pass rate percentage (0-100).
// Uses MongoDB aggregation to efficiently compute pass rates for multiple users at once.
// This is used by /admin/roster to show user success rates.
//
// Aggregation logic:
// 1. Match: filter to project submissions for the given user IDs
// 2. Group by userId, count total submissions and passed submissions
// 3. Calculate pass rate as (passed / total) * 100
func GetPassRatesByUserIDs(ctx context.Context, userIDs []string) (map[string]int, error) {
	if len(userIDs) == 0 {
		return make(map[string]int), nil
	}

	collection := GetBrowserSubmissionsCollection()

	pipeline := mongo.Pipeline{
		// Match: filter to project submissions for these users
		{{Key: "$match", Value: bson.M{
			"userId":     bson.M{"$in": userIDs},
			"sourceType": "project",
		}}},
		// Group by user, count total and passed
		{{Key: "$group", Value: bson.M{
			"_id":              "$userId",
			"totalSubmissions": bson.M{"$sum": 1},
			"passedSubmissions": bson.M{
				"$sum": bson.M{
					"$cond": []interface{}{
						"$passed",
						1,
						0,
					},
				},
			},
		}}},
		// Calculate pass rate percentage
		{{Key: "$project", Value: bson.M{
			"_id": 1,
			"passRate": bson.M{
				"$cond": []interface{}{
					bson.M{"$gt": []interface{}{"$totalSubmissions", 0}},
					bson.M{
						"$round": []interface{}{
							bson.M{
								"$multiply": []interface{}{
									bson.M{
										"$divide": []interface{}{"$passedSubmissions", "$totalSubmissions"},
									},
									100,
								},
							},
							0,
						},
					},
					0,
				},
			},
		}}},
	}

	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregation failed: %w", err)
	}
	defer cursor.Close(ctx)

	result := make(map[string]int)
	for cursor.Next(ctx) {
		var doc struct {
			ID       string `bson:"_id"`
			PassRate int    `bson:"passRate"`
		}
		if err := cursor.Decode(&doc); err != nil {
			return nil, fmt.Errorf("failed to decode: %w", err)
		}
		result[doc.ID] = doc.PassRate
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	return result, nil
}
