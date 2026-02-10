package database

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/internal/clients/supabase"
)

// WhitelistClient handles Supabase beta_whitelist table operations
type WhitelistClient struct {
	supabaseURL string
	serviceKey  string
	httpClient  *http.Client
}

// WhitelistEntry represents a row in the beta_whitelist table
type WhitelistEntry struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

var Whitelist *WhitelistClient

// InitWhitelistClient initializes the Supabase whitelist client
func InitWhitelistClient() error {
	cfg := config.GetConfig()

	if cfg.SupabaseUrl == "" || cfg.SupabaseServiceRoleKey == "" {
		return fmt.Errorf("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in config")
	}

	Whitelist = &WhitelistClient{
		supabaseURL: strings.TrimSuffix(cfg.SupabaseUrl, "/"),
		serviceKey:  cfg.SupabaseServiceRoleKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	return nil
}

// IsEmailWhitelisted checks if an email exists in the beta_whitelist table
func (w *WhitelistClient) IsEmailWhitelisted(email string) (bool, error) {
	// Build the query URL with filter
	endpoint := fmt.Sprintf("%s/rest/v1/beta_whitelist", w.supabaseURL)

	// Use eq filter for exact email match
	queryURL := fmt.Sprintf("%s?email=eq.%s&select=email", endpoint, url.QueryEscape(email))

	req, err := http.NewRequest("GET", queryURL, nil)
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("apikey", w.serviceKey)
	req.Header.Set("Authorization", "Bearer "+w.serviceKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("failed to query whitelist: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("supabase query failed with status %d: %s", resp.StatusCode, string(body))
	}

	var entries []WhitelistEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return false, fmt.Errorf("failed to decode response: %w", err)
	}

	return len(entries) > 0, nil
}

// AddEmail adds an email to the beta_whitelist table
func (w *WhitelistClient) AddEmail(email string) error {
	endpoint := fmt.Sprintf("%s/rest/v1/beta_whitelist", w.supabaseURL)

	payload := map[string]string{"email": email}
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", endpoint, strings.NewReader(string(jsonPayload)))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("apikey", w.serviceKey)
	req.Header.Set("Authorization", "Bearer "+w.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	// return=minimal: don't return the inserted row, resolution=ignore-duplicates: skip if email exists
	req.Header.Set("Prefer", "return=minimal,resolution=ignore-duplicates")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to insert email: %w", err)
	}
	defer resp.Body.Close()

	// 201 Created or 200 OK (for upsert) are both success
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		// Check if it's a duplicate key error (409 Conflict) - treat as success
		if resp.StatusCode == http.StatusConflict {
			return nil // Email already exists, that's fine
		}
		return fmt.Errorf("supabase insert failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// CountWhitelistEntries returns the total number of entries in the beta_whitelist table
func (w *WhitelistClient) CountWhitelistEntries() (int, error) {
	endpoint := fmt.Sprintf("%s/rest/v1/beta_whitelist?select=id", w.supabaseURL)

	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("apikey", w.serviceKey)
	req.Header.Set("Authorization", "Bearer "+w.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	// Request count header
	req.Header.Set("Prefer", "count=exact")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to query whitelist: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("supabase query failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Supabase returns count in Content-Range header when Prefer: count=exact is set
	// Format: "0-N/total" or "*/total" if no results
	contentRange := resp.Header.Get("Content-Range")
	if contentRange != "" {
		var total int
		// Parse "0-N/total" format
		if _, err := fmt.Sscanf(contentRange, "%*d-%*d/%d", &total); err == nil {
			return total, nil
		}
		// Parse "*/total" format (empty result set)
		if _, err := fmt.Sscanf(contentRange, "*/%d", &total); err == nil {
			return total, nil
		}
	}

	// Fallback: count the returned entries
	var entries []WhitelistEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	return len(entries), nil
}

// RemoveEmail removes an email from the beta_whitelist table
func (w *WhitelistClient) RemoveEmail(email string) error {
	endpoint := fmt.Sprintf("%s/rest/v1/beta_whitelist?email=eq.%s", w.supabaseURL, url.QueryEscape(email))

	req, err := http.NewRequest("DELETE", endpoint, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("apikey", w.serviceKey)
	req.Header.Set("Authorization", "Bearer "+w.serviceKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete email: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase delete failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// CountTotalSupabaseUsers returns the total count of users in Supabase auth.users
// Excludes internal users if excludedSupabaseUserIDs is provided
func CountTotalSupabaseUsers(ctx context.Context, excludedSupabaseUserIDs []string) (int, error) {
	cfg := config.GetConfig()
	client, err := supabase.NewAdminClient(cfg.SupabaseUrl, cfg.SupabaseServiceRoleKey)
	if err != nil {
		return 0, fmt.Errorf("failed to create Supabase admin client: %w", err)
	}

	users, err := client.GetAllUsers()
	if err != nil {
		return 0, fmt.Errorf("failed to get users from Supabase: %w", err)
	}

	// If no exclusions, return total count
	if len(excludedSupabaseUserIDs) == 0 {
		return len(users), nil
	}

	// Create exclusion map for fast lookup
	excludeMap := make(map[string]bool, len(excludedSupabaseUserIDs))
	for _, id := range excludedSupabaseUserIDs {
		excludeMap[id] = true
	}

	// Count non-excluded users
	count := 0
	for _, user := range users {
		if !excludeMap[user.ID] {
			count++
		}
	}

	return count, nil
}
