package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/shared"
	"github.com/labstack/echo/v4"
)

// ReferralApplicationPayload is the expected request body for creating a referral application
type ReferralApplicationPayload struct {
	FullName       string `json:"fullName"`
	Email          string `json:"email"`
	TargetCompany  string `json:"targetCompany"`
	Role           string `json:"role"`
	Profession     string `json:"profession"`
	School         string `json:"school"`
	PhoneNumber    string `json:"phoneNumber"`
	Address        string `json:"address"`
	LinkedInURL    string `json:"linkedInUrl"`
	JobURL         string `json:"jobUrl"`
	ResumeURL      string `json:"resumeUrl"`
	Motivation     string `json:"motivation"`
	AdditionalInfo string `json:"additionalInfo"`
	NotionPageID   string `json:"notionPageId"`
	NotionURL      string `json:"notionUrl"`
}

// CreateReferralApplication handles POST /webhooks/referral - webhook from external form/Notion
func CreateReferralApplication(c echo.Context) error {
	// Validate webhook secret (using same pattern as user sync webhook)
	cfg := config.GetConfig()
	secret := c.Request().Header.Get("X-Webhook-Secret")
	expectedSecret := cfg.ReferralWebhookSecret

	// If secret is configured, validate it
	if expectedSecret != "" && secret != expectedSecret {
		c.Logger().Warnf("Invalid referral webhook secret received")
		return c.JSON(http.StatusUnauthorized, echo.Map{
			"error": "Invalid webhook secret",
		})
	}

	var payload ReferralApplicationPayload
	if err := c.Bind(&payload); err != nil {
		c.Logger().Errorf("Failed to parse referral application payload: %v", err)
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if payload.Email == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Email is required",
		})
	}

	if payload.FullName == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{
			"error": "Full name is required",
		})
	}

	ctx := context.Background()
	now := time.Now()

	// Build the referral application document
	app := shared.ReferralApplicationDocument{
		FullName:       payload.FullName,
		Email:          payload.Email,
		TargetCompany:  payload.TargetCompany,
		Role:           payload.Role,
		Profession:     payload.Profession,
		School:         payload.School,
		PhoneNumber:    payload.PhoneNumber,
		Address:        payload.Address,
		LinkedInURL:    payload.LinkedInURL,
		JobURL:         payload.JobURL,
		ResumeURL:      payload.ResumeURL,
		Motivation:     payload.Motivation,
		AdditionalInfo: payload.AdditionalInfo,
		NotionPageID:   payload.NotionPageID,
		NotionURL:      payload.NotionURL,
		Source:         "google_form_referral",
		Status:         "pending",
		MatchedBy:      "none",
		MatchConfidence: "none",
		SubmittedAt:    now,
		UpdatedAt:      now,
	}

	// Try to find existing user by email (case-insensitive)
	normalizedEmail := shared.NormalizeEmail(payload.Email)
	existingUser, err := database.AppCollections.Users.GetUserByEmailNormalized(ctx, normalizedEmail)

	if err == nil && existingUser != nil {
		// Found matching user
		app.UserID = &existingUser.ID
		app.MatchedBy = "email"
		app.MatchConfidence = "high"
		app.MatchedAt = &now
		app.NeedsManualReview = false
		c.Logger().Infof("Matched referral application to existing user: %s", normalizedEmail)
	} else {
		// No match found
		app.UserID = nil
		app.NeedsManualReview = true
		app.ReviewReason = "No email match found - potential new user or different email"
		c.Logger().Infof("No user match for referral application: %s", normalizedEmail)
	}

	// Insert into referral_applications collection
	insertedID, err := database.AppCollections.ReferralApplications.CreateReferralApplication(ctx, app)
	if err != nil {
		c.Logger().Errorf("Failed to create referral application: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to create referral application",
		})
	}

	c.Logger().Infof("Successfully created referral application for %s (ID: %s)", payload.Email, insertedID.Hex())
	return c.JSON(http.StatusCreated, echo.Map{
		"id":      insertedID,
		"message": "Referral application created successfully",
		"matched": app.UserID != nil,
	})
}

// GetReferralApplications handles GET /admin/referrals - list referral applications (admin only)
func GetReferralApplications(c echo.Context) error {
	ctx := context.Background()

	// Get pending applications with limit
	apps, err := database.AppCollections.ReferralApplications.GetPendingReferralApplications(ctx, 100)
	if err != nil {
		c.Logger().Errorf("Failed to fetch referral applications: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to fetch referral applications",
		})
	}

	return c.JSON(http.StatusOK, apps)
}

// GetReferralApplicationsNeedingReview handles GET /admin/referrals/review - get apps needing manual review
func GetReferralApplicationsNeedingReview(c echo.Context) error {
	ctx := context.Background()

	apps, err := database.AppCollections.ReferralApplications.GetApplicationsNeedingReview(ctx)
	if err != nil {
		c.Logger().Errorf("Failed to fetch referral applications needing review: %v", err)
		return c.JSON(http.StatusInternalServerError, echo.Map{
			"error": "Failed to fetch applications needing review",
		})
	}

	return c.JSON(http.StatusOK, apps)
}
