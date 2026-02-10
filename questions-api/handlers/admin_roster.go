package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/internal/clients/supabase"
	"github.com/labstack/echo/v4"
)

// GetRoster handles GET /admin/roster
// Fetches users from Supabase and enriches with project completion data from MongoDB.
// Returns:
//   - users: Supabase user list
//   - projectsTotal: total curriculum projects (from content DB)
//   - projectsCompletedByUser: map of supabaseUserId -> completed project count
func GetRoster(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
	defer cancel()

	page, _ := strconv.Atoi(c.QueryParam("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// 1. Fetch users from Supabase
	cfg := config.GetConfig()
	client, err := supabase.NewAdminClient(cfg.SupabaseUrl, cfg.SupabaseServiceRoleKey)
	if err != nil {
		c.Logger().Errorf("Failed to create Supabase client: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Internal server error"})
	}

	users, err := client.ListUsers(page, limit)
	if err != nil {
		c.Logger().Errorf("Failed to list users from Supabase: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to fetch roster"})
	}

	// 2. Count total curriculum projects from content DB
	projectsTotal, err := database.ContentCollections.Projects.CountProjectsTotal(ctx)
	if err != nil {
		c.Logger().Errorf("Failed to count projects: %v", err)
		// Don't fail the request, just log and return 0
		projectsTotal = 0
	}

	// 3. Extract user IDs for aggregation query
	userIDs := make([]string, len(users))
	for i, u := range users {
		userIDs[i] = u.ID
	}

	// 4. Get completed project counts per user with a single aggregation query
	projectsCompletedByUser, err := database.GetCompletedProjectCountsByUserIDs(ctx, userIDs)
	if err != nil {
		c.Logger().Errorf("Failed to get completed project counts: %v", err)
		// Don't fail the request, just return empty map
		projectsCompletedByUser = make(map[string]int)
	}

	// 5. Get pass rates per user
	passRatesByUser, err := database.GetPassRatesByUserIDs(ctx, userIDs)
	if err != nil {
		c.Logger().Errorf("Failed to get pass rates: %v", err)
		// Don't fail the request, just return empty map
		passRatesByUser = make(map[string]int)
	}

	// Return enriched response
	return c.JSON(http.StatusOK, echo.Map{
		"users":                   users,
		"page":                    page,
		"limit":                   limit,
		"projectsTotal":           projectsTotal,
		"projectsCompletedByUser": projectsCompletedByUser,
		"passRatesByUser":         passRatesByUser,
	})
}
