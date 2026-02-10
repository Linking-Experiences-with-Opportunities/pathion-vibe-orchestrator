package routes

import (
	"strings"

	"github.com/gerdinv/questions-api/config"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// ConfigureCORS sets up CORS middleware with proper origins
func ConfigureCORS(e *echo.Echo) {
	cfg := config.GetConfig()

	// Get allowed origins from environment
	allowedOrigins := []string{
		"http://localhost:3000",                // Local development
		"http://localhost:7777",                // Docker development
		"https://localhost:3000",               // Local HTTPS
		"https://learnwleo.com",                // Production
		"https://staging.learnwleo.com",        // Staging
		"https://mvp-web-app-livid.vercel.app", // Vercel production
		"https://www.learnwleo.com",            // Production (www)
	}

	// Add custom origins from config
	if cfg.AllowedOrigins != "" {
		origins := strings.Split(cfg.AllowedOrigins, ",")
		for _, origin := range origins {
			origin = strings.TrimSpace(origin)
			origin = strings.TrimRight(origin, "/")
			if origin == "" || origin == "*" {
				continue
			}
			allowedOrigins = append(allowedOrigins, origin)
		}
	}

	// Configure CORS
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: allowedOrigins,
		AllowMethods: []string{
			echo.GET,
			echo.HEAD,
			echo.PUT,
			echo.PATCH,
			echo.POST,
			echo.DELETE,
			echo.OPTIONS,
		},
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"Cache-Control",
			"X-Runner-Contract-Version",
		},
		ExposeHeaders: []string{
			"X-Runner-Contract-Version",
		},
		AllowCredentials: true,
		MaxAge:           86400, // 24 hours
	}))
}
