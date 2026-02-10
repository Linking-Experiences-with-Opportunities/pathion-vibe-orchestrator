package supabase

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client is the Supabase admin client
type Client struct {
	url            string
	serviceRoleKey string
	httpClient     *http.Client
}

// NewAdminClient creates a new Supabase admin client with the given URL and service role key
func NewAdminClient(url, serviceRoleKey string) (*Client, error) {
	if url == "" || serviceRoleKey == "" {
		return nil, fmt.Errorf("supabase URL and service role key are required")
	}

	return &Client{
		url:            url,
		serviceRoleKey: serviceRoleKey,
		httpClient:     &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// GetURL returns the configured Supabase URL
func (c *Client) GetURL() string {
	return c.url
}

// User represents a Supabase user
type User struct {
	ID               string                 `json:"id"`
	Email            string                 `json:"email"`
	EmailConfirmedAt *string                `json:"email_confirmed_at"`
	UserMetadata     map[string]interface{} `json:"user_metadata"`
	CreatedAt        string                 `json:"created_at"`
	LastSignInAt     string                 `json:"last_sign_in_at"`
}

// ListUsersResponse response from Supabase list users
type ListUsersResponse struct {
	Users []User `json:"users"`
	Aud   string `json:"aud"`
}

// ListUsers fetches a page of users
// page is 1-based, perPage is number of users per page
func (c *Client) ListUsers(page, perPage int) ([]User, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/auth/v1/admin/users", c.url), nil)
	if err != nil {
		return nil, err
	}

	q := req.URL.Query()
	q.Add("page", fmt.Sprintf("%d", page))
	q.Add("per_page", fmt.Sprintf("%d", perPage))
	req.URL.RawQuery = q.Encode()

	c.addHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase api returned status %d", resp.StatusCode)
	}

	var response ListUsersResponse
	// Supabase might return just []User or {users: []} depending on endpoint version/doc.
	// The GoTrue admin api usually returns { users: [], ... }
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, err
	}

	return response.Users, nil
}

// GetAllUsers fetches ALL users (handling pagination internally)
// Use with caution on large datasets
func (c *Client) GetAllUsers() ([]User, error) {
	var allUsers []User
	page := 1
	perPage := 1000 // Max allowed by Supabase usually

	for {
		users, err := c.ListUsers(page, perPage)
		if err != nil {
			return nil, err
		}

		if len(users) == 0 {
			break
		}

		allUsers = append(allUsers, users...)

		if len(users) < perPage {
			break
		}
		page++
	}

	return allUsers, nil
}

func (c *Client) addHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.serviceRoleKey)
	req.Header.Set("apikey", c.serviceRoleKey)
}
