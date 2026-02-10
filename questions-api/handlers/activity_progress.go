package handlers

import (
	"net/http"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
)

// CreateActivityProgress marks an activity as complete for the authenticated user.
// POST /modules/:id/progress
// Request body: { "activityId": "0" }
// Response: { "success": true, "completedAt": "2024-01-15T10:30:00Z" }
func CreateActivityProgress(c echo.Context) error {
	moduleId := c.Param("id")
	if moduleId == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Missing module ID"})
	}

	// Get user claims from JWT
	user, ok := GetUserClaims(c)
	if !ok {
		c.Logger().Warnf("CreateActivityProgress: Failed to get user claims from context")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}
	if user.Email == "" {
		c.Logger().Warnf("CreateActivityProgress: User email is empty")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized: Email required"})
	}

	// Parse request body
	var payload shared.MarkActivityCompletePayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Invalid request body"})
	}
	if payload.ActivityID == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "activityId is required"})
	}

	// Create the progress document
	doc := shared.ActivityProgressDocument{
		Email:       user.Email,
		ModuleID:    moduleId,
		ActivityID:  payload.ActivityID,
		CompletedAt: time.Now(),
	}

	// Upsert the progress (idempotent operation)
	err := database.AppCollections.ActivityProgress.UpsertActivityProgress(c.Request().Context(), doc)
	if err != nil {
		c.Logger().Errorf("CreateActivityProgress: Failed to upsert progress: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to save progress"})
	}

	c.Logger().Infof("CreateActivityProgress: Marked activity %s complete for module %s, user %s",
		payload.ActivityID, moduleId, user.Email)

	return c.JSON(http.StatusOK, echo.Map{
		"success":     true,
		"completedAt": doc.CompletedAt,
	})
}

// GetActivityProgress returns the list of completed activity IDs for a specific module.
// GET /modules/:id/progress
// Response: { "completedActivityIds": ["0", "2", "3"] }
func GetActivityProgress(c echo.Context) error {
	moduleId := c.Param("id")
	if moduleId == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"error": "Missing module ID"})
	}

	// Get user claims from JWT
	user, ok := GetUserClaims(c)
	if !ok {
		c.Logger().Warnf("GetActivityProgress: Failed to get user claims from context")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}
	if user.Email == "" {
		c.Logger().Warnf("GetActivityProgress: User email is empty")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized: Email required"})
	}

	// Get completed activity IDs for this module
	activityIds, err := database.AppCollections.ActivityProgress.GetProgressForModule(
		c.Request().Context(), user.Email, moduleId)
	if err != nil {
		c.Logger().Errorf("GetActivityProgress: Failed to get progress: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to fetch progress"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"completedActivityIds": activityIds,
	})
}

// GetAllActivityProgress returns progress for all modules for the authenticated user.
// GET /modules/progress
// Response: { "progress": { "moduleId1": ["0", "2"], "moduleId2": ["0", "1", "3"] } }
func GetAllActivityProgress(c echo.Context) error {
	// Get user claims from JWT
	user, ok := GetUserClaims(c)
	if !ok {
		c.Logger().Warnf("GetAllActivityProgress: Failed to get user claims from context")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
	}
	if user.Email == "" {
		c.Logger().Warnf("GetAllActivityProgress: User email is empty")
		return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized: Email required"})
	}

	// Get all progress for this user
	progressMap, err := database.AppCollections.ActivityProgress.GetAllUserProgress(
		c.Request().Context(), user.Email)
	if err != nil {
		c.Logger().Errorf("GetAllActivityProgress: Failed to get progress: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{"error": "Failed to fetch progress"})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"progress": progressMap,
	})
}
