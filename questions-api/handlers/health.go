package handlers

import (
	"net/http"
	"os"
	"strings"
	"time"
	"github.com/labstack/echo/v4"
)

// HealthResponse represents the unified health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Env       string `json:"env"`
	Version   string `json:"version"`
	BuildTime string `json:"build_time"`
	ServerTime string `json:"server_time"`
}

// GetHealth handles GET /api/health
// Returns unified health status including version, environment, and timestamps
func GetHealth(c echo.Context) error {
	// Get NODE_ENV and map to deployment environment
	nodeEnv := strings.ToLower(strings.TrimSpace(os.Getenv("NODE_ENV")))
	env := mapNodeEnvToDeployEnv(nodeEnv)

	// Get version from GIT_COMMIT_SHA (injected at build time)
	version := os.Getenv("GIT_COMMIT_SHA")
	if version == "" {
		version = "unknown"
	}

	// Get build time from DEPLOYED_AT (injected at build time)
	buildTime := os.Getenv("DEPLOYED_AT")
	if buildTime == "" {
		buildTime = "unknown"
	}

	// Get current server time in ISO 8601 format
	serverTime := time.Now().UTC().Format(time.RFC3339)

	response := HealthResponse{
		Status:    "ok",
		Service:   "questions-api",
		Env:       env,
		Version:   version,
		BuildTime: buildTime,
		ServerTime: serverTime,
	}

	// Log the health check with structured information
	c.Logger().Infof(
		"[HEALTH_CHECK] env=%s version=%s path=%s timestamp=%s",
		env, version, c.Request().URL.Path, serverTime,
	)

	return c.JSON(http.StatusOK, response)
}

// mapNodeEnvToDeployEnv maps NODE_ENV to deployment environment name
// production -> prod
// staging -> staging
// (empty or anything else) -> local
func mapNodeEnvToDeployEnv(nodeEnv string) string {
	switch strings.ToLower(strings.TrimSpace(nodeEnv)) {
	case "production":
		return "prod"
	case "staging":
		return "staging"
	default:
		return "local"
	}
}
