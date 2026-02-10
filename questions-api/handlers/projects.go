package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type ProjectListItem struct {
	ID            string                `json:"id"`  // ProjectNumber as string for backward compatibility
	MongoID       string                `json:"_id"` // MongoDB Object ID for references (e.g. module links)
	ProjectNumber int                   `json:"projectNumber"`
	Title         string                `json:"title"`
	Difficulty    shared.DifficultyType `json:"difficulty"`
	Description   string                `json:"description"`
	Category      string                `json:"category"`
	Tags          []string              `json:"tags"`
	TotalTests    int                   `json:"totalTests"`
	PassedTests   int                   `json:"passedTests"`
	IsCompleted   bool                  `json:"isCompleted"`
}

type ProjectDetail struct {
	ID            string                 `json:"id"`
	ProjectNumber int                    `json:"projectNumber"`
	Title         string                 `json:"title"`
	Difficulty    shared.DifficultyType  `json:"difficulty"`
	Description   string                 `json:"description"`
	Instructions  string                 `json:"instructions"`
	StarterFiles  map[string]string      `json:"starterFiles"`
	TestFile      shared.ProjectTestFile `json:"testFile"`
	Category      string                 `json:"category"`
	Tags          []string               `json:"tags"`
	Limits        ProjectLimits          `json:"limits"`
}

type ProjectLimits struct {
	TimeoutMs int `json:"timeoutMs"`
	MemoryMB  int `json:"memoryMB"`
}

// GetProjects returns all projects with user progress if authenticated
func GetProjects(c echo.Context) error {
	c.Response().Header().Set(
		"Cache-Control",
		"public, max-age=300, stale-while-revalidate=86400",
	)

	cfg := config.GetConfig()

	// Optional category filter
	category := c.QueryParam("category")

	var projects []shared.ProjectDocument
	var err error

	// Read from content DB
	if category != "" {
		projects, err = database.ContentCollections.Projects.GetProjectsByCategory(c.Request().Context(), category)
	} else {
		projects, err = database.ContentCollections.Projects.GetAllProjects(c.Request().Context())
	}

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch projects",
		})
	}

	// Get authenticated user (optional - if not logged in, show projects without progress)
	var userId string
	if user, ok := GetUserClaims(c); ok && user.UserID != "" {
		userId = user.UserID
	}

	// Fetch user submissions if authenticated
	progressMap := make(map[int]struct {
		TotalTests  int
		PassedTests int
		IsCompleted bool
	})

	if userId != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		collection := database.GetAppDb().Collection("browser_submissions")

		// Find all project submissions for this user
		// Matches "project", missing field, or empty string
		filter := bson.M{
			"userId": userId,
			"$or": []bson.M{
				{"sourceType": "project"},
				{"sourceType": bson.M{"$exists": false}},
				{"sourceType": ""},
			},
		}
		cursor, err := collection.Find(ctx, filter)
		if err == nil {
			defer cursor.Close(ctx)

			// Iterate one by one to avoid failing on a single bad document
			// Iterate one by one
			for cursor.Next(ctx) {
				// Define a partial struct to avoid decoding errors on unused fields
				var sub struct {
					ProblemID string `bson:"problemId"`
					Passed    bool   `bson:"passed"`
					Result    struct {
						TestSummary *struct {
							Total  int `bson:"total"`
							Passed int `bson:"passed"`
						} `bson:"testSummary"`
					} `bson:"result"`
				}

				if err := cursor.Decode(&sub); err != nil {
					// Skip bad documents
					continue
				}

				// problemId is stored as string, convert to int
				projectNum, err := strconv.Atoi(sub.ProblemID)
				if err != nil {
					continue
				}

				current := progressMap[projectNum]

				// Track highest passed tests
				if sub.Result.TestSummary != nil {
					// Always update TotalTests if we have test data
					if sub.Result.TestSummary.Total > 0 {
						current.TotalTests = sub.Result.TestSummary.Total
					}

					// Track highest passed tests (personal best)
					if sub.Result.TestSummary.Passed > current.PassedTests {
						current.PassedTests = sub.Result.TestSummary.Passed
					}
				}

				// Track if any submission fully passed
				if sub.Passed {
					current.IsCompleted = true
				}

				progressMap[projectNum] = current
			}
		}
	}

	// Build response with progress data
	projectList := make([]ProjectListItem, len(projects))
	for i, p := range projects {
		progress := progressMap[p.ProjectNumber]

		projectList[i] = ProjectListItem{
			ID:            strconv.Itoa(p.ProjectNumber),
			MongoID:       p.ID.Hex(),
			ProjectNumber: p.ProjectNumber,
			Title:         p.Title,
			Difficulty:    p.Difficulty,
			Description:   p.Description,
			Category:      p.Category,
			Tags:          p.Tags,
			TotalTests:    progress.TotalTests,
			PassedTests:   progress.PassedTests,
			IsCompleted:   progress.IsCompleted,
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"projects":              projectList,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}

// GetProjectByID returns detailed project information
func GetProjectByID(c echo.Context) error {
	cfg := config.GetConfig()

	idStr := c.Param("id")
	projectNumber, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid project ID",
		})
	}

	// Read from content DB
	project, err := database.ContentCollections.Projects.GetProjectByNumber(c.Request().Context(), projectNumber)
	if err != nil || project == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Project not found",
		})
	}

	detail := ProjectDetail{
		ID:            strconv.Itoa(project.ProjectNumber),
		ProjectNumber: project.ProjectNumber,
		Title:         project.Title,
		Difficulty:    project.Difficulty,
		Description:   project.Description,
		Instructions:  project.Instructions,
		StarterFiles:  project.StarterFiles,
		TestFile:      project.TestFile,
		Category:      project.Category,
		Tags:          project.Tags,
		Limits: ProjectLimits{
			TimeoutMs: 10000, // 10 seconds for data structure projects
			MemoryMB:  256,   // More memory for complex data structures
		},
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"project":               detail,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}

// CreateProject handles admin project creation
func CreateProject(c echo.Context) error {
	var payload shared.ProjectPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request data",
		})
	}

	// Admin content creation - write to content DB
	projectId, err := database.ContentCollections.Projects.CreateProject(c.Request().Context(), payload)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"id":      "",
			"error":   err.Error(),
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"id":      projectId,
	})
}

// UpdateProject handles admin project updates
func UpdateProject(c echo.Context) error {
	idStr := c.Param("id")
	projectNumber, err := strconv.Atoi(idStr) // ✅ Parse as integer
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid project ID",
		})
	}

	var payload shared.ProjectPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request data",
		})
	}

	// Verify project exists before updating
	// Query by projectNumber, not _id
	project, err := database.ContentCollections.Projects.GetProjectByNumber(c.Request().Context(), projectNumber)
	if err != nil || project == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Project not found",
		})
	}

	// Admin content update - write to content DB
	err = database.ContentCollections.Projects.UpdateProject(c.Request().Context(), projectNumber, payload)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// DeleteProject handles admin project deletion
func DeleteProject(c echo.Context) error {
	idStr := c.Param("id")
	projectNumber, err := strconv.Atoi(idStr) // ✅ Parse as integer
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid project ID",
		})
	}

	// Verify project exists before deleting
	// Query by projectNumber, not _id
	project, err := database.ContentCollections.Projects.GetProjectByNumber(c.Request().Context(), projectNumber)
	if err != nil || project == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Project not found",
		})
	}

	// Admin content deletion - write to content DB
	err = database.ContentCollections.Projects.DeleteProject(c.Request().Context(), projectNumber)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// GetProjectSubmissions returns all submissions for a specific project
func GetProjectSubmissions(c echo.Context) error {
	cfg := config.GetConfig()

	idStr := c.Param("id")
	projectNumber, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid project ID",
		})
	}

	// Extract user from JWT token
	user, ok := GetUserClaims(c)
	if !ok || user.UserID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized",
		})
	}
	userId := user.UserID

	// Verify project exists
	// Read from content DB
	project, err := database.ContentCollections.Projects.GetProjectByNumber(c.Request().Context(), projectNumber)
	if err != nil || project == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "Project not found",
		})
	}

	// Query browser_submissions collection for submissions with matching problemId
	// Runtime data - read from app DB
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	collection := database.GetAppDb().Collection("browser_submissions")

	// Find all submissions where problemId matches the project ID (as string) AND userId matches
	filter := bson.M{
		"problemId": idStr,
		"userId":    userId,
	}
	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch submissions",
		})
	}
	defer cursor.Close(ctx)

	// Decode all submissions
	var submissions []database.BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to decode submissions",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"submissions":           submissions,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}

// GetUserProjectSubmissions returns all submissions for a specific user and project (Admin only)
func GetUserProjectSubmissions(c echo.Context) error {
	cfg := config.GetConfig()

	// Get email and project ID from URL parameters
	emailRaw := c.Param("email")
	projectIdStr := c.Param("projectId")

	email, err := DecodeEmailParam(emailRaw)
	if err != nil {
		c.Logger().Errorf("[GetUserProjectSubmissions] Failed to decode email '%s': %v", emailRaw, err)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid email parameter encoding",
		})
	}

	c.Logger().Infof("[GetUserProjectSubmissions] Fetching submissions for user %s, project %s", email, projectIdStr)

	projectNumber, err := strconv.Atoi(projectIdStr)
	if err != nil {
		c.Logger().Errorf("[GetUserProjectSubmissions] Invalid project ID: %s", projectIdStr)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid project ID",
		})
	}

	// Try to get project details (from content DB)
	// If project doesn't exist, we'll use a fallback title but still return submissions
	project, err := database.ContentCollections.Projects.GetProjectByNumber(c.Request().Context(), projectNumber)
	projectTitle := ""
	if err != nil || project == nil {
		c.Logger().Warnf("[GetUserProjectSubmissions] Project not found in content DB: %d, using fallback title", projectNumber)
		projectTitle = fmt.Sprintf("Project #%d", projectNumber)
	} else {
		projectTitle = project.Title
	}

	// Query browser_submissions collection for submissions (from app DB)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	collection := database.GetAppDb().Collection("browser_submissions")

	// Find all submissions where problemId matches AND emailNormalized matches
	// Using emailNormalized for consistent case-insensitive matching
	emailNormalized := strings.ToLower(strings.TrimSpace(email))
	filter := bson.M{
		"problemId":       projectIdStr,
		"emailNormalized": emailNormalized,
	}

	// Sort by createdAt descending (most recent first)
	findOptions := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})

	cursor, err := collection.Find(ctx, filter, findOptions)
	if err != nil {
		c.Logger().Errorf("[GetUserProjectSubmissions] Failed to query submissions: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch submissions",
		})
	}
	defer cursor.Close(ctx)

	// Decode all submissions
	var submissions []database.BrowserSubmissionDocument
	if err := cursor.All(ctx, &submissions); err != nil {
		c.Logger().Errorf("[GetUserProjectSubmissions] Failed to decode submissions: %v", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to decode submissions",
		})
	}

	c.Logger().Infof("[GetUserProjectSubmissions] Found %d submissions for user %s, project %s", len(submissions), email, projectIdStr)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"submissions":           submissions,
		"projectTitle":          projectTitle,
		"runnerContractVersion": cfg.RunnerContractVersion,
	})
}
