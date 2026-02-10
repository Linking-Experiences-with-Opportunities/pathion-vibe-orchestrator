package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/labstack/echo/v4"
)

// TelemetryEvent represents a telemetry event from the frontend
type TelemetryEvent struct {
	Event      string                 `json:"event"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Timestamp  int64                  `json:"timestamp,omitempty"`
	UserID     string                 `json:"userId,omitempty"`
	SessionID  string                 `json:"sessionId,omitempty"`
}

// CreateTelemetryEvent handles POST /telemetry
func CreateTelemetryEvent(c echo.Context) error {
	// Parse request body
	var event TelemetryEvent
	if err := c.Bind(&event); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	// Get additional context
	userAgent := c.Request().Header.Get("User-Agent")
	ip := c.RealIP()

	// Get user info from JWT - STRICT MODE: Source of Truth
	user, ok := GetUserClaims(c)
	if !ok {
		c.Logger().Warnf("CreateTelemetryEvent: Failed to get user claims from context")
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid User UUID required",
		})
	}
	if user.UserID == "" {
		c.Logger().Warnf("CreateTelemetryEvent: UserClaims.UserID is empty. Full claims: %+v", user)
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Unauthorized: Valid User UUID required",
		})
	}
	c.Logger().Infof("CreateTelemetryEvent: Successfully got user - UserID: %s, Email: %s", user.UserID, user.Email)

	// Determine environment
	cfg := config.GetConfig()
	env := cfg.AppEnv
	if env == "" {
		if cfg.NodeEnv == "production" {
			env = "production"
		} else {
			env = "development"
		}
	}

	// Create event document
	doc := database.RunnerEventDocument{
		Event:           event.Event,
		Properties:      event.Properties,
		UserID:          user.UserID, // STRICT: Always use JWT UUID
		Email:           user.Email,  // Metadata only
		EmailNormalized: strings.ToLower(strings.TrimSpace(user.Email)),
		SessionID:       event.SessionID,
		UserAgent:       userAgent,
		IP:              ip,
		Environment:     env,
		CreatedAt:       time.Now(),
	}

	// For runner_result events, we might want to do additional processing
	if event.Event == "runner_result" {
		// Log important metrics
		if props := event.Properties; props != nil {
			c.Logger().Infof("Runner result: exitCode=%v, duration=%v, mode=%v, problemId=%v",
				props["exit_code"], props["duration_ms"], props["mode"], props["problem_id"])
		}
	}

	// Insert into MongoDB
	err := database.CreateRunnerEvent(&doc)
	if err != nil {
		// Don't fail the request if telemetry fails
		c.Logger().Errorf("Failed to save telemetry event: %v", err)
	}

	// Always return success for telemetry
	return c.JSON(http.StatusOK, map[string]string{
		"status": "ok",
	})
}
