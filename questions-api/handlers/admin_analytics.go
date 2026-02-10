package handlers

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// GetUserDetailedMetrics handles GET /admin/users/:email/metrics (or :id)
func GetUserDetailedMetrics(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), DefaultQueryTimeout)
	defer cancel()

	identifier := c.Param("email") // Can be email or UUID

	// Check if it looks like an email or UUID
	isEmail := strings.Contains(identifier, "@")
	var user *shared.UserDocument

	// Basic validation
	if isEmail {
		decoded, err := DecodeEmailParam(identifier)
		if err == nil {
			identifier = decoded
		}
		if err := validateEmail(identifier); err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"error": err.Error()})
		}

		// Legacy: Try to get user from Mongo ONLY if it's an email
		u, err := database.AppCollections.Users.GetUserByEmail(ctx, identifier)
		if err == nil {
			user = u
		}
	}

	// Build metrics using the identifier (Email or UUID)
	// We pass 'user' if we found one (for legacy email/name).
	metrics, err := buildUserMetrics(ctx, c, identifier, user)
	if err != nil {
		c.Logger().Errorf("Failed to build metrics for %s: %v", identifier, err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to calculate user metrics",
			"details": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, metrics)
}

// buildUserMetrics aggregates all user metrics
func buildUserMetrics(ctx context.Context, c echo.Context, identifier string, user *shared.UserDocument) (*shared.UserDetailedMetrics, error) {
	// Fetch all projects and submissions
	allProjects, err := database.ContentCollections.Projects.GetAllProjects(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch projects: %w", err)
	}

	submissions, err := database.GetSubmissionsByUser(ctx, identifier, "project", 0)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch submissions: %w", err)
	}

	// Calculate project stats
	projectStats := calculateProjectStats(ctx, identifier, allProjects, submissions)

	// Build recent submissions
	recentSubmissions := buildRecentSubmissions(ctx, submissions, MaxRecentSubmissions)

	// Calculate project attempts
	projectAttempts, err := calculateProjectAttempts(ctx, c, identifier)
	if err != nil {
		c.Logger().Warnf("Failed to calculate project attempts for %s: %v", identifier, err)
		projectAttempts = []shared.ProjectAttemptMetrics{}
	}

	// Extract browser/device info
	telemetryCol := database.GetTelemetryCollection()
	browserInfo := extractBrowserInfo(ctx, telemetryCol, identifier)

	email := identifier
	name := identifier
	if user != nil {
		email = user.Email
		name = user.Name
	}

	// Build response
	return &shared.UserDetailedMetrics{
		Email:             email,
		Name:              name,
		Role:              "student",
		ProjectStats:      projectStats,
		RecentSubmissions: recentSubmissions,
		ProjectAttempts:   projectAttempts,
		LastSeenBrowser:   browserInfo.Browser,
		LastSeenOS:        browserInfo.OS,
		LastSeenDevice:    browserInfo.Device,
	}, nil
}

// calculateProjectAttempts builds attempt metrics for each project (extracted for clarity)
func calculateProjectAttempts(ctx context.Context, c echo.Context, email string) ([]shared.ProjectAttemptMetrics, error) {
	uniqueProjectIDs, err := database.GetUniqueProjectIDsByUser(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("failed to get unique project IDs: %w", err)
	}

	completedProjectIDs, err := database.GetCompletedProjectIDsByUser(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("failed to get completed project IDs: %w", err)
	}

	completedMap := make(map[string]bool, len(completedProjectIDs))
	for _, pid := range completedProjectIDs {
		completedMap[pid] = true
	}

	telemetryCol := database.GetTelemetryCollection()
	projectAttempts := make([]shared.ProjectAttemptMetrics, 0, len(uniqueProjectIDs))

	for _, projectID := range uniqueProjectIDs {
		// Fetch telemetry events
		runEvents, err := telemetryCol.GetEventsByUserAndProject(ctx, email, projectID, "project_run_attempt")
		if err != nil {
			c.Logger().Warnf("Failed to get run events for project %s: %v", projectID, err)
			runEvents = []database.RunnerEventDocument{}
		}

		submitEvents, err := telemetryCol.GetEventsByUserAndProject(ctx, email, projectID, "project_submit_attempt")
		if err != nil {
			c.Logger().Warnf("Failed to get submit events for project %s: %v", projectID, err)
			submitEvents = []database.RunnerEventDocument{}
		}

		resultEvents, err := telemetryCol.GetEventsByUserAndProject(ctx, email, projectID, "project_submission_result")
		if err != nil {
			c.Logger().Warnf("Failed to get result events for project %s: %v", projectID, err)
			resultEvents = []database.RunnerEventDocument{}
		}

		// Calculate metrics
		attemptsBeforePass := countAttemptsBeforeSuccess(runEvents, submitEvents, resultEvents)
		failedTests := aggregateFailedTests(resultEvents)
		avgExecTime := calculateAvgExecutionTime(ctx, email, projectID)
		projectTitle := database.GetProjectTitle(ctx, projectID)

		projectAttempts = append(projectAttempts, shared.ProjectAttemptMetrics{
			ProjectID:          projectID,
			ProjectTitle:       projectTitle,
			AttemptsBeforePass: attemptsBeforePass,
			RunAttempts:        len(runEvents),
			SubmitAttempts:     len(submitEvents),
			Completed:          completedMap[projectID],
			AvgExecutionTimeMs: avgExecTime,
			FailedTests:        failedTests,
		})
	}

	return projectAttempts, nil
}

// Helper function to calculate platform analytics
func calculatePlatformAnalytics(ctx context.Context, excludedSupabaseUserIDs []string) (*shared.PlatformAnalytics, error) {
	telemetryCol := database.GetTelemetryCollection()
	now := time.Now()

	// DAU: Users active in last 24 hours
	oneDayAgo := now.Add(-24 * time.Hour)
	dau, err := telemetryCol.GetDistinctUsersSince(ctx, oneDayAgo, excludedSupabaseUserIDs)
	if err != nil {
		return nil, err
	}

	// WAU: Users active in last 7 days
	sevenDaysAgo := now.Add(-7 * 24 * time.Hour)
	wau, err := telemetryCol.GetDistinctUsersSince(ctx, sevenDaysAgo, excludedSupabaseUserIDs)
	if err != nil {
		return nil, err
	}

	// MAU: Users active in last 30 days
	thirtyDaysAgo := now.Add(-30 * 24 * time.Hour)
	mau, err := telemetryCol.GetDistinctUsersSince(ctx, thirtyDaysAgo, excludedSupabaseUserIDs)
	if err != nil {
		return nil, err
	}

	// DAU Trend: Daily counts for last 30 days
	dauTrend := make([]shared.TrendDataPoint, 0, 30)
	for i := 29; i >= 0; i-- {
		date := now.Add(time.Duration(-i) * 24 * time.Hour)
		startOfDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
		endOfDay := startOfDay.Add(24 * time.Hour)

		count, err := telemetryCol.GetDistinctUsersInRange(ctx, startOfDay, endOfDay, excludedSupabaseUserIDs)
		if err != nil {
			// Log warning but continue with zero count
			count = 0
		}

		dauTrend = append(dauTrend, shared.TrendDataPoint{
			Date:  startOfDay.Format("2006-01-02"),
			Count: count,
		})
	}

	// WAU Trend: Weekly counts for last 12 weeks
	wauTrend := make([]shared.TrendDataPoint, 0, 12)
	for i := 11; i >= 0; i-- {
		weekStart := now.Add(time.Duration(-i) * 7 * 24 * time.Hour)
		// Align to Monday
		weekStart = getMonday(weekStart)
		weekEnd := weekStart.Add(7 * 24 * time.Hour)

		count, err := telemetryCol.GetDistinctUsersInRange(ctx, weekStart, weekEnd, excludedSupabaseUserIDs)
		if err != nil {
			// Log warning but continue with zero count
			count = 0
		}

		wauTrend = append(wauTrend, shared.TrendDataPoint{
			WeekStart: weekStart.Format("2006-01-02"),
			Count:     count,
		})
	}

	// Calculate execution metrics
	executionMetrics, err := calculateExecutionMetrics(ctx)
	if err != nil {
		// Use empty metrics on error
		executionMetrics = newEmptyExecutionMetrics()
	}

	// Calculate browser analytics
	browserAnalytics, err := calculateBrowserAnalytics(ctx)
	if err != nil {
		// Use empty analytics on error
		browserAnalytics = newEmptyBrowserAnalytics()
	}

	return &shared.PlatformAnalytics{
		DAU:              dau,
		WAU:              wau,
		MAU:              mau,
		DAUTrend:         dauTrend,
		WAUTrend:         wauTrend,
		ExecutionMetrics: executionMetrics,
		BrowserAnalytics: browserAnalytics,
	}, nil
}

// getMonday returns the Monday of the week for the given date
func getMonday(t time.Time) time.Time {
	// Get to the start of the day
	t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())

	// Calculate days to subtract to get to Monday
	daysToMonday := (int(t.Weekday()) - int(time.Monday) + 7) % 7
	return t.Add(time.Duration(-daysToMonday) * 24 * time.Hour)
}

// CreateAnalyticsIndexes handles POST /admin/indexes/create
// Creates MongoDB indexes for optimal analytics query performance
func CreateAnalyticsIndexes(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), DefaultQueryTimeout)
	defer cancel()

	// Create telemetry indexes
	if err := database.CreateTelemetryIndexes(ctx); err != nil {
		c.Logger().Errorf("Failed to create telemetry indexes: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to create telemetry indexes",
			"details": err.Error(),
		})
	}

	// Create submission indexes
	if err := database.CreateSubmissionIndexes(ctx); err != nil {
		c.Logger().Errorf("Failed to create submission indexes: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to create submission indexes",
			"details": err.Error(),
		})
	}

	// Create browser analytics indexes
	if err := database.CreateBrowserAnalyticsIndexes(ctx); err != nil {
		c.Logger().Errorf("Failed to create browser analytics indexes: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to create browser analytics indexes",
			"details": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"status":  "success",
		"message": "Analytics indexes created successfully",
	})
}

// calculateExecutionMetrics aggregates execution time data
func calculateExecutionMetrics(ctx context.Context) (*shared.ExecutionMetrics, error) {
	// Get all submissions with execution time
	submissions, err := database.GetAllSubmissionsWithExecutionTime(ctx)
	if err != nil {
		return nil, err
	}

	if len(submissions) == 0 {
		return newEmptyExecutionMetrics(), nil
	}

	// Extract execution times
	times := make([]int64, 0, len(submissions))
	ttfrTimes := make([]int64, 0, len(submissions))
	for _, sub := range submissions {
		if sub.Result.DurationMs > 0 {
			times = append(times, int64(sub.Result.DurationMs))
		}
		if sub.Result.TTFRMs > 0 {
			ttfrTimes = append(ttfrTimes, int64(sub.Result.TTFRMs))
		}
	}

	// Calculate statistics
	avgTime := calculateAverage(times)
	medianTime := calculateMedian(times)
	minTime := calculateMin(times)
	maxTime := calculateMax(times)

	// Calculate per-project averages
	allProjects, err := database.ContentCollections.Projects.GetAllProjects(ctx)
	if err != nil {
		return nil, err
	}

	executionsByProject := make([]shared.ProjectExecution, 0)
	for _, project := range allProjects {
		projectID := fmt.Sprintf("%d", project.ProjectNumber)
		projectSubs, err := database.GetSubmissionsWithExecutionTimeByProject(ctx, projectID)
		if err != nil {
			continue
		}

		if len(projectSubs) > 0 {
			projectTimes := make([]int64, 0, len(projectSubs))
			projectTTFRTimes := make([]int64, 0, len(projectSubs))
			for _, sub := range projectSubs {
				if sub.Result.DurationMs > 0 {
					projectTimes = append(projectTimes, int64(sub.Result.DurationMs))
				}
				if sub.Result.TTFRMs > 0 {
					projectTTFRTimes = append(projectTTFRTimes, int64(sub.Result.TTFRMs))
				}
			}

			if len(projectTimes) > 0 {
				executionsByProject = append(executionsByProject, shared.ProjectExecution{
					ProjectID:      projectID,
					ProjectTitle:   project.Title,
					AvgTimeMs:      calculateAverage(projectTimes),
					AvgTTFRMs:      calculateAverage(projectTTFRTimes),
					ExecutionCount: len(projectSubs),
				})
			}
		}
	}

	// Sort by execution count descending
	sort.Slice(executionsByProject, func(i, j int) bool {
		return executionsByProject[i].ExecutionCount > executionsByProject[j].ExecutionCount
	})

	return &shared.ExecutionMetrics{
		AvgExecutionTimeMs:    avgTime,
		MedianExecutionTimeMs: medianTime,
		MinExecutionTimeMs:    minTime,
		MaxExecutionTimeMs:    maxTime,
		TotalExecutions:       len(submissions),
		AvgTTFRMs:             calculateAverage(ttfrTimes),
		ExecutionsByProject:   executionsByProject,
	}, nil
}

// calculateBrowserAnalytics aggregates browser/device usage data
func calculateBrowserAnalytics(ctx context.Context) (*shared.BrowserAnalytics, error) {
	telemetryCol := database.GetTelemetryCollection()

	// Get all telemetry events with browser info
	telemetry, err := telemetryCol.GetAllTelemetryWithBrowserInfo(ctx)
	if err != nil {
		return nil, err
	}

	if len(telemetry) == 0 {
		return newEmptyBrowserAnalytics(), nil
	}

	// Count by browser, OS, and device
	browserCounts := make(map[string]int)
	osCounts := make(map[string]int)
	deviceCounts := make(map[string]int)

	for _, event := range telemetry {
		if event.Properties != nil {
			if browser, ok := event.Properties["browser"].(string); ok && browser != "" {
				browserCounts[browser]++
			}
			if os, ok := event.Properties["os"].(string); ok && os != "" {
				osCounts[os]++
			}
			if deviceType, ok := event.Properties["deviceType"].(string); ok && deviceType != "" {
				deviceCounts[deviceType]++
			}
		}
	}

	total := float64(len(telemetry))

	// Convert to breakdown with percentages
	browserBreakdown := make([]shared.BrowserStat, 0, len(browserCounts))
	for browser, count := range browserCounts {
		browserBreakdown = append(browserBreakdown, shared.BrowserStat{
			Browser:    browser,
			Count:      count,
			Percentage: (float64(count) / total) * 100,
		})
	}
	sort.Slice(browserBreakdown, func(i, j int) bool {
		return browserBreakdown[i].Count > browserBreakdown[j].Count
	})

	osBreakdown := make([]shared.OSStat, 0, len(osCounts))
	for os, count := range osCounts {
		osBreakdown = append(osBreakdown, shared.OSStat{
			OS:         os,
			Count:      count,
			Percentage: (float64(count) / total) * 100,
		})
	}
	sort.Slice(osBreakdown, func(i, j int) bool {
		return osBreakdown[i].Count > osBreakdown[j].Count
	})

	deviceBreakdown := make([]shared.DeviceStat, 0, len(deviceCounts))
	for deviceType, count := range deviceCounts {
		deviceBreakdown = append(deviceBreakdown, shared.DeviceStat{
			DeviceType: deviceType,
			Count:      count,
			Percentage: (float64(count) / total) * 100,
		})
	}
	sort.Slice(deviceBreakdown, func(i, j int) bool {
		return deviceBreakdown[i].Count > deviceBreakdown[j].Count
	})

	return &shared.BrowserAnalytics{
		BrowserBreakdown: browserBreakdown,
		OSBreakdown:      osBreakdown,
		DeviceBreakdown:  deviceBreakdown,
	}, nil
}

// Helper functions for statistics

func calculateAverage(times []int64) int64 {
	if len(times) == 0 {
		return 0
	}
	var sum int64 = 0
	for _, t := range times {
		sum += t
	}
	return sum / int64(len(times))
}

func calculateMedian(times []int64) int64 {
	if len(times) == 0 {
		return 0
	}
	sorted := make([]int64, len(times))
	copy(sorted, times)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})
	mid := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[mid-1] + sorted[mid]) / 2
	}
	return sorted[mid]
}

func calculateMin(times []int64) int64 {
	if len(times) == 0 {
		return 0
	}
	min := times[0]
	for _, t := range times {
		if t < min {
			min = t
		}
	}
	return min
}

func calculateMax(times []int64) int64 {
	if len(times) == 0 {
		return 0
	}
	max := times[0]
	for _, t := range times {
		if t > max {
			max = t
		}
	}
	return max
}

// LatestSubmissionResponse represents a submission for the admin submissions feed
type LatestSubmissionResponse struct {
	ID           string                `json:"_id"`
	UserID       string                `json:"userId"`
	Email        string                `json:"email"`
	Image        string                `json:"image"`
	ProjectTitle string                `json:"projectTitle"`
	ProblemID    string                `json:"problemId"`
	Passed       bool                  `json:"passed"`
	TestSummary  LatestSubmissionTests `json:"testSummary"`
	DurationMs   int                   `json:"durationMs"`
	OS           string                `json:"os"`
	CreatedAt    string                `json:"createdAt"`
}

type LatestSubmissionTests struct {
	Passed int `json:"passed"`
	Total  int `json:"total"`
}

// parseOS parses the User-Agent string to return a readable OS name
func parseOS(ua string) string {
	if ua == "" {
		return "Unknown"
	}
	uaLower := strings.ToLower(ua)
	if strings.Contains(uaLower, "mac") || strings.Contains(uaLower, "darwin") {
		return "macOS"
	} else if strings.Contains(uaLower, "win") {
		return "Windows"
	} else if strings.Contains(uaLower, "android") {
		return "Android"
	} else if strings.Contains(uaLower, "linux") {
		return "Linux"
	} else if strings.Contains(uaLower, "ios") || strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad") {
		return "iOS"
	}
	return "Other"
}

// GetLatestSubmissions handles GET /admin/submissions/latest
// Returns the most recent project submissions for the admin dashboard
// Query params:
//   - limit: number of submissions (default 20, max 100)
//   - timeRange: filter by time period (1h, 12h, 24h, 7d, 30d, all)
func GetLatestSubmissions(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), DefaultQueryTimeout)
	defer cancel()

	// Get limit from query param, default to 20
	limit := 20
	if limitParam := c.QueryParam("limit"); limitParam != "" {
		if l, err := fmt.Sscanf(limitParam, "%d", &limit); err == nil && l > 0 {
			if limit > 100 {
				limit = 100 // Cap at 100
			}
		}
	}

	// Get time range filter
	timeRange := c.QueryParam("timeRange")
	includeInternalStr := c.QueryParam("include_internal")
	includeInternal := includeInternalStr == "true"

	var sinceTime *time.Time
	now := time.Now()

	// Exclude internal users if requested
	var excludedSupabaseUserIDs []string
	if !includeInternal {
		var err error
		excludedSupabaseUserIDs, err = GetInternalSupabaseIDs(ctx, []string{"linkedinorleftout.com"}, nil)
		if err != nil {
			c.Logger().Errorf("Failed to get internal user IDs: %v", err)
			// Continue without exclusion on error to safely fallback
		}
	}

	switch timeRange {
	case "1h":
		t := now.Add(-1 * time.Hour)
		sinceTime = &t
	case "12h":
		t := now.Add(-12 * time.Hour)
		sinceTime = &t
	case "24h":
		t := now.Add(-24 * time.Hour)
		sinceTime = &t
	case "7d":
		t := now.Add(-7 * 24 * time.Hour)
		sinceTime = &t
	case "30d":
		t := now.Add(-30 * 24 * time.Hour)
		sinceTime = &t
	case "all", "":
		// No time filter
		sinceTime = nil
	default:
		// Invalid time range, ignore and use all
		sinceTime = nil
	}

	// Query browser_submissions sorted by createdAt desc
	collection := database.GetBrowserSubmissionsCollection()

	filter := bson.M{
		"sourceType": "project",
		"userId":     bson.M{"$exists": true, "$ne": ""},
	}

	if len(excludedSupabaseUserIDs) > 0 {
		filter["supabaseUserId"] = bson.M{"$nin": excludedSupabaseUserIDs}
	}

	// Add time filter if specified
	if sinceTime != nil {
		filter["createdAt"] = bson.M{"$gte": *sinceTime}
	}

	findOptions := options.Find().
		SetSort(bson.D{{Key: "createdAt", Value: -1}}).
		SetLimit(int64(limit))

	cursor, err := collection.Find(ctx, filter, findOptions)
	if err != nil {
		c.Logger().Errorf("Failed to query submissions: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to fetch submissions",
		})
	}
	defer cursor.Close(ctx)

	var submissions []database.BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		c.Logger().Errorf("Failed to decode submissions: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to decode submissions",
		})
	}

	// Build response with project titles and user names
	response := make([]LatestSubmissionResponse, 0, len(submissions))

	// Cache project titles to avoid repeated lookups
	projectTitleCache := make(map[string]string)

	for _, sub := range submissions {
		// DEBUG: Print User Agent to debug OS recognition
		// fmt.Printf("DEBUG: SubID: %s | UA: '%s' | Parsed: %s\n", sub.ID.Hex(), sub.UserAgent, parseOS(sub.UserAgent))

		// Get project title (with caching)
		projectTitle, ok := projectTitleCache[sub.ProblemID]
		if !ok {
			projectTitle = database.GetProjectTitle(ctx, sub.ProblemID)
			projectTitleCache[sub.ProblemID] = projectTitle
		}

		// Use data directly from the submission document
		// We no longer join with the legacy users collection
		userDisplayName := sub.UserID
		userDisplayEmail := sub.Email
		userDisplayImage := "" // Profile images not available without Supabase lookup

		// If we have a SupabaseUserID, that is the primary ID
		if sub.SupabaseUserID != "" {
			userDisplayName = sub.SupabaseUserID
		}

		if sub.EmailNormalized != "" {
			// Use normalized email as fallback display if available
			// logic: userDisplayName is usually just the ID here unless we have a name.
			// Since we don't have name without lookup, we can try to show email if helpful.
		}

		// Fallback for legacy data where UserID is the email
		if userDisplayEmail == "" && strings.Contains(sub.UserID, "@") {
			userDisplayEmail = sub.UserID
			userDisplayName = sub.UserID
		}

		// Fallback for email if empty (e.g. from UUID only lookup failure)
		if userDisplayEmail == "" {
			userDisplayEmail = "Unknown Email"
		}

		// Build test summary
		testSummary := LatestSubmissionTests{
			Passed: 0,
			Total:  0,
		}
		if sub.Result.TestSummary != nil {
			testSummary.Passed = sub.Result.TestSummary.Passed
			testSummary.Total = sub.Result.TestSummary.Total
		}

		response = append(response, LatestSubmissionResponse{
			ID:           sub.ID.Hex(),
			UserID:       userDisplayName,  // Name (or email if name missing)
			Email:        userDisplayEmail, // Actual email
			Image:        userDisplayImage, // User avatar URL
			ProjectTitle: projectTitle,
			ProblemID:    sub.ProblemID,
			Passed:       sub.Passed,
			TestSummary:  testSummary,
			DurationMs:   sub.Result.DurationMs,
			OS:           parseOS(sub.UserAgent),
			CreatedAt:    sub.CreatedAt.Format(time.RFC3339),
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"submissions": response,
	})
}

// FunnelMetricsResponse represents the pre-activation onboarding funnel metrics
// Stages are CAUSALLY ORDERED: each stage is a subset of the previous stage
type FunnelMetricsResponse struct {
	// Stage 0: Total distinct users in Supabase (invited or signed up)
	TotalUsers int `json:"totalUsers"`
	// Stage 1: Users who created an account (have record in MongoDB)
	SignedIn int `json:"signedIn"`
	// Stage 2: Users who ran code on Project 0 (warmup)
	WarmupRun int `json:"warmupRun"`
	// Stage 3: Users who submitted Project 0 (warmup)
	WarmupSubmit int `json:"warmupSubmit"`
	// Stage 4: Users who ran code on any real project (projectNumber >= 1)
	EnteredCurriculum int `json:"enteredCurriculum"`
	// Stage 5: Users who submitted at least 1 real project (projectNumber >= 1)
	Activated int `json:"activated"`
	// Stage 6: Activated users who completed at least 1 real project (passed=true, projectNumber >= 1)
	Completed int `json:"completed"`
	// Stage 7: Activated users who returned and performed meaningful action (>1 session day)
	Retained int `json:"retained"`
}

// GetFunnelMetrics handles GET /admin/metrics/funnel
// Returns pre-activation onboarding funnel metrics for the admin dashboard
// All stages are CAUSALLY ORDERED (each is a subset of the previous)
func GetFunnelMetrics(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), DefaultQueryTimeout)
	defer cancel()

	var response FunnelMetricsResponse

	// Get inclusion flag
	includeInternalStr := c.QueryParam("include_internal")
	includeInternal := includeInternalStr == "true"

	var excludedSupabaseUserIDs []string
	if !includeInternal {
		var err error
		excludedSupabaseUserIDs, err = GetInternalSupabaseIDs(ctx, []string{"linkedinorleftout.com"}, nil)
		if err != nil {
			c.Logger().Errorf("Failed to get internal user IDs: %v", err)
		}
	}

	// Stage 0: Total Users - Count all distinct users in Supabase auth.users
	totalUserCount, err := database.CountTotalSupabaseUsers(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count total Supabase users: %v", err)
	} else {
		response.TotalUsers = totalUserCount
	}

	// Stage 1: Signed In - Count from MongoDB users collection
	signedInCount, err := database.AppCollections.Users.CountUsers(ctx)
	if err != nil {
		c.Logger().Warnf("Failed to count users: %v", err)
	} else {
		response.SignedIn = int(signedInCount)
	}

	// Stage 2: Warmup Run - Users who ran code on Project 0
	// Uses telemetry events (project_run_attempt with projectNumber=0)
	warmupRunCount, err := database.CountUsersWhoRanWarmup(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count warmup run users: %v", err)
	} else {
		response.WarmupRun = warmupRunCount
	}

	// Stage 3: Warmup Submit - Users who submitted Project 0
	// Uses browser_submissions with projectNumber=0
	warmupSubmitCount, err := database.CountUsersWhoSubmittedWarmup(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count warmup submit users: %v", err)
	} else {
		response.WarmupSubmit = warmupSubmitCount
	}

	// Stage 4: Entered Curriculum - Users who ran code on any real project (projectNumber >= 1)
	// Uses telemetry events (project_run_attempt with projectNumber >= 1)
	enteredCount, err := database.CountUsersWhoEnteredCurriculum(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count users who entered curriculum: %v", err)
	} else {
		response.EnteredCurriculum = enteredCount
	}

	// Stage 5: Activated - Users who submitted at least 1 real project (projectNumber >= 1)
	activatedCount, err := database.CountDistinctActivatedUsers(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count activated users: %v", err)
	} else {
		response.Activated = activatedCount
	}

	// Stage 6: Completed - Activated users who passed at least 1 real project
	completedCount, err := database.CountDistinctCompletedRealProjects(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count completed users: %v", err)
	} else {
		response.Completed = completedCount
	}

	// Stage 7: Retained - Activated users who returned (>1 distinct session day)
	retainedCount, err := database.CountRetainedActivatedUsers(ctx, excludedSupabaseUserIDs)
	if err != nil {
		c.Logger().Warnf("Failed to count retained users: %v", err)
	} else {
		response.Retained = retainedCount
	}

	return c.JSON(http.StatusOK, response)
}
