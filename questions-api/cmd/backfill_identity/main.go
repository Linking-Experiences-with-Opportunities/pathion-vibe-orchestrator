package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/database"
	"github.com/gerdinv/questions-api/internal/clients/supabase"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var (
	dryRun     bool
	batchSize  int
	maxUpdates int
	env        string
)

func main() {
	flag.BoolVar(&dryRun, "dry-run", true, "Perform a dry run without updating documents")
	flag.IntVar(&batchSize, "batch-size", 5000, "Number of documents to process in a batch")
	flag.IntVar(&maxUpdates, "max-updates", 0, "Maximum number of documents to update (0 = unlimited)")
	flag.StringVar(&env, "env", "development", "Environment to run against (development/production)")
	flag.Parse()

	// Load env vars
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system env vars")
	}

	// Explicit Environment Mapping
	var dbName string
	switch env {
	case "production":
		dbName = "lilolp_prod"
	case "development":
		dbName = "lilolp_dev"
	default:
		log.Fatalf("❌ Invalid env '%s'. Must be 'development' or 'production'.", env)
	}

	// Set NODE_ENV for database connection logic (legacy fallback)
	os.Setenv("NODE_ENV", env)
	// Force the explicit DB name if the database package supports customization,
	// but currently database.ConnectMongoDB() uses env vars. 
	// We'll rely on the standard env var/logic but print explicitly what we expect.
	// Actually, careful here: database package likely derives DB from MONGO_DB_APP or MONGO_DB_APP_DEV env vars.
	// Let's verify what database.GetAppDb() does. 
	// For this script, we can just print what we *expect* and let the user verify.
	
	// Mask Supabase URL for logging
	supaURL := os.Getenv("SUPABASE_URL")
	maskedURL := "******"
	if len(supaURL) > 10 {
		maskedURL = supaURL[:8] + "..." + supaURL[len(supaURL)-4:]
	}

	log.Printf("🚀 Starting Backfill Identity Migration")
	log.Printf("==================================================")
	log.Printf("   Configuration Review:")
	log.Printf("   ---------------------")
	log.Printf("   Environment:       %s", env)
	log.Printf("   Target DB (Exp):   %s", dbName)
	log.Printf("   Target Collections: runner_events, browser_submissions")
	log.Printf("   Dry Run:           %v", dryRun)
	log.Printf("   Batch Size:        %d", batchSize)
	log.Printf("   Max Updates:       %d (0=unlimited)", maxUpdates)
	log.Printf("   Supabase URL:      %s", maskedURL)
	log.Printf("==================================================")
	log.Println("⚠️  Please confirm the above configuration is correct.")
	if !dryRun {
		log.Println("⚠️  RUNNING IN NON-DRY-RUN MODE. CHANGES WILL BE APPLIED.")
		log.Println("   Waiting 5 seconds before starting...")
		time.Sleep(5 * time.Second)
	}

	// Connect to Database
	database.ConnectMongoDB()
	appDb := database.GetAppDb()
	
	// Verify DB Name matches expectation
	if appDb.Name() != dbName {
		log.Printf("⚠️  WARNING: Connected DB name '%s' does not match expected '%s'", appDb.Name(), dbName)
		if !dryRun {
			log.Fatal("❌ Aborting due to DB name mismatch in live run.")
		}
	} else {
		log.Printf("✅ Connected to App DB: %s", appDb.Name())
	}

	// Connect to Supabase
	supaClient, err := supabase.NewAdminClient(supaURL, os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
	if err != nil {
		log.Fatalf("❌ Failed to create Supabase client: %v", err)
	}

	// 1. Build Identity Map
	log.Println("🔍 fetching users from Supabase to build identity map...")
	users, err := supaClient.GetAllUsers()
	if err != nil {
		log.Fatalf("❌ Failed to fetch users: %v", err)
	}
	log.Printf("   Found %d users in Supabase. Building email map...", len(users))

	identityMap := make(map[string]string) // normalized email -> uuid
	for _, u := range users {
		if u.Email != "" {
			normalized := strings.ToLower(strings.TrimSpace(u.Email))
			identityMap[normalized] = u.ID
		}
	}
	log.Printf("   Identity map built with %d entries.", len(identityMap))

	// 2. Backfill Runner Events
	if err := backfillCollection(appDb.Collection("runner_events"), identityMap, "runner_events"); err != nil {
		log.Fatalf("❌ Failed to backfill runner_events: %v", err)
	}

	// 3. Backfill Browser Submissions
	if err := backfillCollection(appDb.Collection("browser_submissions"), identityMap, "browser_submissions"); err != nil {
		log.Fatalf("❌ Failed to backfill browser_submissions: %v", err)
	}

	log.Println("✨ Migration completed successfully")
}

func backfillCollection(coll *mongo.Collection, identityMap map[string]string, name string) error {
	log.Printf("Start processing %s...", name)
	ctx := context.Background()

	// Find documents where supabaseUserId is missing AND (email exists OR userId exists)
	filter := bson.M{
		"supabaseUserId": bson.M{"$exists": false},
		"$or": []bson.M{
			{"email": bson.M{"$exists": true, "$ne": ""}},
			{"userId": bson.M{"$exists": true, "$ne": ""}},
		},
	}

	total, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return err
	}
	log.Printf("   Found %d documents needing backfill in %s", total, name)

	if total == 0 {
		return nil
	}

	processed := 0
	updated := 0
	unmapped := 0

	cursor, err := coll.Find(ctx, filter)
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)

	// Since we are iterating and updating, and we might have millions of docs,
	// let's process in chunks or just iterate carefully.
	// For simplicity in this script, we'll iterate the cursor and use bulk writes.

	var operations []mongo.WriteModel

	for cursor.Next(ctx) {
		var doc struct {
			ID              bson.RawValue `bson:"_id"`
			Email           string        `bson:"email"`
			EmailNormalized string        `bson:"emailNormalized"`
			UserID          string        `bson:"userId"` // Legacy ID
		}

		if err := cursor.Decode(&doc); err != nil {
			log.Printf("   Error decoding doc: %v", err)
			continue
		}

		processed++


		// Determine candidate email matches
		candidates := []string{}
		
		// Priority 1: Normalized Email on doc
		if doc.EmailNormalized != "" {
			candidates = append(candidates, doc.EmailNormalized)
		}
		
		// Priority 2: Email on doc
		if doc.Email != "" {
			candidates = append(candidates, strings.ToLower(strings.TrimSpace(doc.Email)))
		}

		// Priority 3: UserID looks like email
		if doc.UserID != "" && strings.Contains(doc.UserID, "@") {
			candidates = append(candidates, strings.ToLower(strings.TrimSpace(doc.UserID)))
		}

		var foundUUID string
		for _, email := range candidates {
			if uuid, ok := identityMap[email]; ok {
				foundUUID = uuid
				break
			}
		}

		if foundUUID != "" {
			op := mongo.NewUpdateOneModel().
				SetFilter(bson.M{"_id": doc.ID}).
				SetUpdate(bson.M{"$set": bson.M{"supabaseUserId": foundUUID}})
			operations = append(operations, op)
			updated++
		} else {
			unmapped++
			// Optional: log unmapped samples for debug
			if unmapped <= 10 {
				log.Printf("      [Unmapped sample] ID: %v | Email: %s | UserID: %s", doc.ID, doc.Email, doc.UserID)
			}
		}

		// Execute batch
		if len(operations) >= batchSize {
			if !dryRun {
				_, err := coll.BulkWrite(ctx, operations)
				if err != nil {
					return fmt.Errorf("bulk write error: %w", err)
				}
			}
			operations = nil
			log.Printf("   Processed %d/%d...", processed, total)
		}

		// Apply Max Updates Limit
		if maxUpdates > 0 && updated >= maxUpdates {
			log.Printf("🛑 Reached max-updates limit (%d). Stopping early for %s.", maxUpdates, name)
			break
		}
	}

	// Flush remaining
	if len(operations) > 0 {
		if !dryRun {
			_, err := coll.BulkWrite(ctx, operations)
			if err != nil {
				return fmt.Errorf("bulk write error: %w", err)
			}
		}
	}

	log.Printf("   Finished %s: Scanned %d, To Update %d, Unmapped %d", name, processed, updated, unmapped)
	return nil
}
