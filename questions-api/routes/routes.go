package routes

import (
	"net/http"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/handlers"
	"github.com/labstack/echo/v4"
)

// RegisterRoutes defines all application routes
func RegisterRoutes(e *echo.Echo) {
	// Canonical unified health endpoint (public, no auth required)
	// Returns health status + version + environment + timestamps
	e.GET("/api/health", handlers.GetHealth)

	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok :D"})
	})

	// Version endpoint to verify deployed commit
	e.GET("/version", func(c echo.Context) error {
		cfg := config.GetConfig()
		version := cfg.GitCommitSha
		if version == "" {
			version = "unknown"
		}
		return c.JSON(http.StatusOK, map[string]string{
			"version":    version,
			"deployedAt": cfg.DeployedAt,
		})
	})

	// Health check with database status (public but limited info)
	e.GET("/health/db", handlers.GetHealthWithDB)

	// Beta whitelist verification - queries Supabase beta_whitelist table
	e.GET("/verify", handlers.CheckWhitelist)

	// Webhook endpoint for Airtable automation (protected by X-Webhook-Secret header)
	e.POST("/webhooks/whitelist", handlers.AddToWhitelist)

	// Webhook endpoint for Supabase user sync (protected by X-Webhook-Secret header)
	e.POST("/webhooks/user-sync", handlers.SyncUserFromSupabase)

	// Webhook endpoint for referral applications (protected by X-Webhook-Secret header)
	e.POST("/webhooks/referral", handlers.CreateReferralApplication)

	// Public browser-based endpoints (no auth required)
	e.GET("/problems", handlers.GetProblems)
	e.GET("/problems/:id", handlers.GetProblemByID)
	e.GET("/projects/:id", handlers.GetProjectByID)
	e.GET("/projects", handlers.GetProjects)

	// JWT-protected routes
	cfg := config.GetConfig()
	jwtMiddleware := SupabaseJWTMiddleware(cfg.SupabaseJwtSecret)

	// Protected browser-based endpoints (JWT-protected)
	e.POST("/submissions", handlers.CreateBrowserSubmission, jwtMiddleware)
	e.POST("/api/submissions", handlers.CreateBrowserSubmission, jwtMiddleware) // Alias for backwards compatibility
	e.GET("/projects/:id/submissions", handlers.GetProjectSubmissions, jwtMiddleware)

	// Telemetry endpoints - JWT required; handler uses GetUserClaims(c) for user ID
	e.POST("/telemetry", handlers.CreateTelemetryEvent, jwtMiddleware)
	e.POST("/api/telemetry", handlers.CreateTelemetryEvent, jwtMiddleware) // Alias for backwards compatibility

	// User tests endpoints (JWT-protected)
	e.GET("/projects/:projectId/user-tests", handlers.GetUserTests, jwtMiddleware)
	e.PUT("/projects/:projectId/user-tests", handlers.SaveUserTests, jwtMiddleware)
	e.DELETE("/projects/:projectId/user-tests", handlers.DeleteUserTests, jwtMiddleware)
	e.GET("/user-tests", handlers.GetAllUserTests, jwtMiddleware)

	// User profile endpoints (JWT-protected)
	e.GET("/profiles/me", handlers.GetMyProfile, jwtMiddleware)
	e.PATCH("/profiles/me", handlers.PatchMyProfile, jwtMiddleware)
	e.GET("/api/profiles/me", handlers.GetMyProfile, jwtMiddleware)     // Alias for backwards compatibility
	e.PATCH("/api/profiles/me", handlers.PatchMyProfile, jwtMiddleware) // Alias for backwards compatibility

	// Report cards endpoints (JWT-protected)
	e.GET("/report-cards/me", handlers.GetMyReportCards, jwtMiddleware)
	e.POST("/report-cards/jobs", handlers.ReportCardsJob, jwtMiddleware)
	e.GET("/api/report-cards/me", handlers.GetMyReportCards, jwtMiddleware)  // Alias
	e.POST("/api/report-cards/jobs", handlers.ReportCardsJob, jwtMiddleware) // Alias

	// Boss fight endpoints (JWT-protected)
	e.GET("/boss-fight/start", handlers.StartBossFight, jwtMiddleware)
	e.GET("/boss-fight/history", handlers.GetBossFightHistory, jwtMiddleware)
	e.GET("/boss-fight/:id", handlers.GetBossFightStatus, jwtMiddleware)
	e.POST("/boss-fight/:id/stage", handlers.UpdateBossFightStage, jwtMiddleware)
	e.POST("/boss-fight/:id/abandon", handlers.AbandonBossFight, jwtMiddleware)

	// Decision Trace Replay endpoints (JWT-protected)
	e.POST("/decision-trace/event", handlers.CreateDecisionTraceEvent, jwtMiddleware)
	e.GET("/decision-trace/session", handlers.GetDecisionTraceSession, jwtMiddleware)
	e.GET("/decision-trace/timeline", handlers.GetDecisionTraceTimeline, jwtMiddleware)
	e.GET("/decision-trace/event", handlers.GetDecisionTraceEvent, jwtMiddleware)

	// For admin group, still use Group but with proper prefix
	authGroup := e.Group("") // keep for admin routes
	authGroup.Use(jwtMiddleware)

	// Admin routes (JWT-protected + Admin role required)
	adminGroup := authGroup.Group("/admin")
	adminGroup.Use(RequireAdminRole())

	adminGroup.POST("/question/run", handlers.WrapRunTestCasesForAdmin) // Wrapped for legacy check
	adminGroup.POST("/question", handlers.CreateQuestion)
	adminGroup.POST("/module", handlers.CreateModule)
	adminGroup.PUT("/module/:id", handlers.UpdateModule)
	adminGroup.DELETE("/module/:id", handlers.DeleteModule)
	adminGroup.GET("/projects", handlers.GetProjects)        // List all projects for admin
	adminGroup.GET("/projects/:id", handlers.GetProjectByID) // Get single project for admin
	adminGroup.POST("/projects", handlers.CreateProject)
	adminGroup.PUT("/projects/:id", handlers.UpdateProject)
	adminGroup.DELETE("/projects/:id", handlers.DeleteProject)
	adminGroup.GET("/questions", handlers.GetAllQuestions)
	adminGroup.GET("/metrics", handlers.GetOverallMetricsForAdmin)
	adminGroup.GET("/metrics/funnel", handlers.GetFunnelMetrics)                                        // Onboarding funnel metrics
	adminGroup.GET("/submissions/latest", handlers.GetLatestSubmissions)                                // Latest submissions feed
	adminGroup.GET("/roster", handlers.GetRoster)                                                       // New Supabase-backed roster
	adminGroup.GET("/users/search", handlers.GetUserSuggestions)                                        // User search endpoint
	adminGroup.GET("/users/:email/metrics", handlers.GetUserDetailedMetrics)                            // New: detailed user metrics
	adminGroup.GET("/users/:email/projects/:projectId/submissions", handlers.GetUserProjectSubmissions) // Get submissions for specific user + project
	adminGroup.POST("/indexes/create", handlers.CreateAnalyticsIndexes)                                 // New: create analytics indexes
	adminGroup.GET("/metrics/user", handlers.GetMetricsForUser)

	// Beta whitelist management (admin only)
	adminGroup.POST("/whitelist", handlers.AddToWhitelist)
	adminGroup.DELETE("/whitelist", handlers.RemoveFromWhitelist)

	// User sync management (admin only)
	adminGroup.POST("/users/backfill", handlers.BackfillUsersFromSupabase)

	// Diagnostics (admin only)
	adminGroup.GET("/diagnostics", handlers.GetDiagnostics)

	// Referral applications management (admin only)
	adminGroup.GET("/referrals", handlers.GetReferralApplications)
	adminGroup.GET("/referrals/review", handlers.GetReferralApplicationsNeedingReview)

	// Public routes
	e.GET("/question/:number", handlers.GetQuestion)
	e.GET("/question/:number/submissions", handlers.GetSubmissionsForQuestion)

	// Question submissions require auth (delegates to CreateBrowserSubmission)
	e.POST("/question/:number/submissions", handlers.CreateQuestionSubmission, jwtMiddleware)
	e.POST("/question/:number/testcases", handlers.SaveTestCase)
	e.POST("/question/:number/testcases/run", handlers.WrapRunTestCases) // Wrapped for legacy check
	e.GET("/modules", handlers.GetAllModules)

	// Activity progress endpoints (JWT-protected)
	// IMPORTANT: Static routes must be registered BEFORE dynamic :id routes to prevent shadowing
	e.GET("/modules/progress", handlers.GetAllActivityProgress, jwtMiddleware)
	e.GET("/modules/:id/progress", handlers.GetActivityProgress, jwtMiddleware)
	e.POST("/modules/:id/progress", handlers.CreateActivityProgress, jwtMiddleware)

	e.GET("/modules/:id", handlers.GetModule)
	e.POST("/modules/:id/testcases/run", handlers.WrapRunModuleTestCases, RateLimitMiddleware(3, time.Minute)) // Wrapped for legacy check
	e.POST("/modules/:id/submission", handlers.CreateModuleQuestionSubmission, RateLimitMiddleware(1, time.Minute))
}
