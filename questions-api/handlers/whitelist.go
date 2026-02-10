package handlers

import (
	"net/http"
	"strings"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/labstack/echo/v4"
)

// WhitelistWebhookPayload represents the incoming webhook from Airtable
type WhitelistWebhookPayload struct {
	Email string `json:"email"`
}

// AddToWhitelist handles POST /admin/whitelist - webhook from Airtable
func AddToWhitelist(c echo.Context) error {
	// Validate webhook secret
	cfg := config.GetConfig()
	secret := c.Request().Header.Get("X-Webhook-Secret")
	expectedSecret := cfg.WhitelistWebhookSecret

	if expectedSecret != "" && secret != expectedSecret {
		return c.JSON(http.StatusUnauthorized, echo.Map{
			"error": "Invalid webhook secret",
		})
	}

	var payload WhitelistWebhookPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Invalid request body",
		})
	}

	// Normalize email
	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if email == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Email is required",
		})
	}

	// Check if whitelist client is initialized
	if database.Whitelist == nil {
		return c.JSON(http.StatusServiceUnavailable, echo.Map{
			"error": "Whitelist service is not configured",
		})
	}

	// Add to whitelist
	if err := database.Whitelist.AddEmail(email); err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to add email to whitelist",
			"details": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"email":   email,
	})
}

// RemoveFromWhitelist handles DELETE /admin/whitelist - remove email from whitelist
func RemoveFromWhitelist(c echo.Context) error {
	email := c.QueryParam("email")
	if email == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Email query parameter is required",
		})
	}

	// Normalize email
	email = strings.TrimSpace(strings.ToLower(email))

	// Check if whitelist client is initialized
	if database.Whitelist == nil {
		return c.JSON(http.StatusServiceUnavailable, echo.Map{
			"error": "Whitelist service is not configured",
		})
	}

	if err := database.Whitelist.RemoveEmail(email); err != nil {
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error":   "Failed to remove email from whitelist",
			"details": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"email":   email,
	})
}

// CheckWhitelist handles GET /verify - check if email is in beta whitelist
func CheckWhitelist(c echo.Context) error {
	email := c.QueryParam("email")

	if email == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "email is required",
		})
	}

	// Normalize email
	email = strings.TrimSpace(strings.ToLower(email))

	// Check if whitelist client is initialized
	if database.Whitelist == nil {
		return c.JSON(http.StatusServiceUnavailable, echo.Map{
			"error": "Whitelist service is not configured",
		})
	}

	inCohort, err := database.Whitelist.IsEmailWhitelisted(email)
	if err != nil {
		// Log error but don't expose details to client
		c.Logger().Errorf("Whitelist check failed for %s: %v", email, err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to check whitelist status",
		})
	}

	return c.JSON(http.StatusOK, echo.Map{
		"inCohort": inCohort,
	})
}
