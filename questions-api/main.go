package main

import (
	"fmt"
	"log"

	"github.com/gerdinv/questions-api/config"
	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/routes"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Initialize config with embedded .env.example contract
	// This must happen before any call to config.GetConfig()
	config.Init(envExampleContract)

	// Connect to MongoDB
	database.ConnectMongoDB()

	// Initialize Supabase whitelist client
	if err := database.InitWhitelistClient(); err != nil {
		log.Printf("⚠️  Whitelist client not initialized: %v", err)
		log.Printf("   Beta whitelist features will be disabled")
	} else {
		log.Println("✅ Whitelist client initialized")
	}

	e := echo.New()

	// CRITICAL: CORS must be the FIRST middleware to handle preflight OPTIONS requests
	// before any other middleware can interfere or return errors
	routes.ConfigureCORS(e)

	// Configure other middleware AFTER CORS
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	// Register routes
	routes.RegisterRoutes(e)

	// Get port from config or default to 1323
	cfg := config.GetConfig()
	port := cfg.Port
	if port == 0 {
		port = 1323
	}

	log.Printf("🚀 Starting server on port %d", port)
	e.Logger.Fatal(e.Start(fmt.Sprintf(":%d", port)))
}
