package handlers

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/internal/clients/supabase"
)

var (
	// Cache map: Key is the Supabase URL (approx proxy for env), Value is (IDs, expiration)
	internalUserCache      = make(map[string]cacheEntry)
	internalUserCacheMutex sync.RWMutex
	cacheDuration          = 1 * time.Hour
)

type cacheEntry struct {
	ids       []string
	expiresAt time.Time
}

// GetInternalSupabaseIDs fetches all users from Supabase and filters for internal emails.
// It uses an in-memory cache keyed by the Supabase URL to avoid hitting Supabase too often and prevent cross-env pollution.
func GetInternalSupabaseIDs(ctx context.Context, domains []string, allowlist []string) ([]string, error) {
	cfg := config.GetConfig()
	client, err := supabase.NewAdminClient(cfg.SupabaseUrl, cfg.SupabaseServiceRoleKey)
	if err != nil {
		return nil, err
	}
	// Use client URL as cache key
	cacheKey := client.GetURL()

	internalUserCacheMutex.RLock()
	if entry, ok := internalUserCache[cacheKey]; ok && time.Now().Before(entry.expiresAt) {
		defer internalUserCacheMutex.RUnlock()
		cached := make([]string, len(entry.ids))
		copy(cached, entry.ids)
		return cached, nil
	}
	internalUserCacheMutex.RUnlock()

	// Cache expired or empty, fetch fresh data
	internalUserCacheMutex.Lock()
	defer internalUserCacheMutex.Unlock()

	// Double check
	if entry, ok := internalUserCache[cacheKey]; ok && time.Now().Before(entry.expiresAt) {
		cached := make([]string, len(entry.ids))
		copy(cached, entry.ids)
		return cached, nil
	}

	// Fetch ALL users
	users, err := client.GetAllUsers()
	if err != nil {
		return nil, err
	}

	var internalIDs []string

	for _, u := range users {
		isInternal := false
		email := strings.ToLower(u.Email)

		// Check domains
		for _, domain := range domains {
			if strings.HasSuffix(email, "@"+strings.ToLower(domain)) {
				isInternal = true
				break
			}
		}

		// Check allowlist
		if !isInternal {
			for _, allowed := range allowlist {
				if email == strings.ToLower(allowed) {
					isInternal = true
					break
				}
			}
		}

		if isInternal {
			internalIDs = append(internalIDs, u.ID)
		}
	}

	// Update cache
	internalUserCache[cacheKey] = cacheEntry{
		ids:       internalIDs,
		expiresAt: time.Now().Add(cacheDuration),
	}

	return internalIDs, nil
}
