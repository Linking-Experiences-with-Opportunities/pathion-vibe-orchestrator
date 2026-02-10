package database

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gerdinv/questions-api/config"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// DBInfo holds diagnostic information about the database connection
type DBInfo struct {
	ContentDBName string           `json:"contentDbName"`
	AppDBName     string           `json:"appDbName"`
	NodeEnv       string           `json:"nodeEnv"`
	ClusterHost   string           `json:"clusterHost"`
	Collections   map[string]int64 `json:"collections"`
}

var ContentCollections *ContentDBCollections
var AppCollections *AppDBCollections
var MongoClient *mongo.Client

// ContentDBCollections contains collections from the shared content database
// (projects, problems, modules, testcases)
type ContentDBCollections struct {
	Questions QuestionCollection
	Testcases TestCasesCollection
	Modules   ModulesCollection
	Projects  ProjectCollection
}

// AppDBCollections contains collections from the runtime app database
// (users, submissions, feedback, telemetry, counters, decision trace)
type AppDBCollections struct {
	ModuleSubmissions     ModuleSubmissionCollection
	Users                 UsersCollection
	UserTests             UserTestsCollection
	ReferralApplications  ReferralApplicationsCollection
	ActivityProgress      ActivityProgressCollection
	DecisionTraceSessions DecisionTraceSessionsCollection
	DecisionTraceEvents   DecisionTraceEventsCollection
}

// DBCollections is kept for backwards compatibility
// It now points to AppCollections for runtime data
var Collections *DBCollections

type DBCollections struct {
	Questions         QuestionCollection
	Testcases         TestCasesCollection
	ModuleSubmissions ModuleSubmissionCollection
	Users             UsersCollection
	Modules           ModulesCollection
	Projects          ProjectCollection
}

// GetContentDb returns the content database instance
// This database contains shared content (projects, problems, modules, testcases)
func GetContentDb() *mongo.Database {
	if MongoClient == nil {
		log.Fatal("MongoDB client not initialized. Call ConnectMongoDB() first.")
	}
	if activeContentDBName == "" {
		log.Fatal("Content DB name not set. Call ConnectMongoDB() first.")
	}
	return MongoClient.Database(activeContentDBName)
}

// GetAppDb returns the app database instance based on NODE_ENV
// - NODE_ENV == "production" → returns lilo_app_prod
// - Otherwise → returns lilo_app_dev
// Note: Uses the cached activeAppDBName set during ConnectMongoDB()
func GetAppDb() *mongo.Database {
	if MongoClient == nil {
		log.Fatal("MongoDB client not initialized. Call ConnectMongoDB() first.")
	}

	// Use the cached active app DB name for consistency
	if activeAppDBName == "" {
		log.Fatal("App DB name not set. Call ConnectMongoDB() first.")
	}
	return MongoClient.Database(activeAppDBName)
}

// activeAppDBName stores the resolved app database name for diagnostics
var activeAppDBName string
var activeContentDBName string
var activeNodeEnv string
var activeClusterHost string
var cachedDevDbName string

func ConnectMongoDB() {
	// Load configuration from typed config system
	cfg := config.GetConfig()

	uri := cfg.MongoUri
	if uri == "" {
		log.Fatal("❌ FATAL: MONGO_URI is not set in config")
	}

	// Extract cluster host for diagnostics (hide credentials)
	activeClusterHost = extractClusterHost(uri)

	contentDbName := cfg.MongoDbContent
	if contentDbName == "" {
		log.Fatal("❌ FATAL: MONGO_DB_CONTENT is not set in config")
	}
	activeContentDBName = contentDbName

	nodeEnv := cfg.NodeEnv
	activeNodeEnv = nodeEnv

	// Cache the dev DB name for GetDevDb() function
	cachedDevDbName = cfg.MongoDbAppDev

	// Determine which app DB to use based on NODE_ENV
	var appDbName string
	if nodeEnv == "production" {
		appDbName = cfg.MongoDbApp
		if appDbName == "" {
			log.Fatal("❌ FATAL: MONGO_DB_APP is required in production (NODE_ENV=production)")
		}
		// Validate that production DB name looks like a production database
		if strings.Contains(strings.ToLower(appDbName), "dev") {
			log.Printf("⚠️  WARNING: Production NODE_ENV but app DB name contains 'dev': %s", appDbName)
		}
	} else if nodeEnv == "staging" {
		appDbName = cfg.MongoDbAppStaging
		if appDbName == "" {
			log.Printf("⚠️  WARNING: MONGO_DB_APP_STAGING is not set; falling back to MONGO_DB_APP_DEV")
			appDbName = cfg.MongoDbAppDev
		}
		if appDbName == "" {
			log.Fatal("❌ FATAL: MONGO_DB_APP_STAGING (or MONGO_DB_APP_DEV fallback) is required in staging (NODE_ENV=staging)")
		}
	} else {
		appDbName = cfg.MongoDbAppDev
		if appDbName == "" {
			log.Fatal("❌ FATAL: MONGO_DB_APP_DEV is required in non-production mode")
		}
		if nodeEnv == "" {
			log.Printf("⚠️  WARNING: NODE_ENV is not set, defaulting to development mode (using %s)", appDbName)
		}
	}
	activeAppDBName = appDbName

	// Log configuration prominently
	log.Println("════════════════════════════════════════════════════════════")
	log.Printf("🔧 DATABASE CONFIGURATION")
	log.Printf("   NODE_ENV:    %s", func() string {
		if nodeEnv == "" {
			return "(not set - development mode)"
		} else {
			return nodeEnv
		}
	}())
	log.Printf("   Content DB:  %s", contentDbName)
	log.Printf("   App DB:      %s", appDbName)
	log.Printf("   Cluster:     %s", activeClusterHost)
	log.Println("════════════════════════════════════════════════════════════")

	clientOptions := options.Client().ApplyURI(uri)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		log.Fatalf("❌ FATAL: Error connecting to MongoDB: %v", err)
	}

	// Check connection
	err = client.Ping(ctx, nil)
	if err != nil {
		log.Fatalf("❌ FATAL: MongoDB not responding: %v", err)
	}

	fmt.Println("✅ Connected to MongoDB")

	// Store the client globally
	MongoClient = client

	fmt.Printf("📦 Content DB: %s\n", contentDbName)
	fmt.Printf("📦 App DB: %s (NODE_ENV=%s)\n", appDbName, func() string {
		if nodeEnv == "" {
			return "development"
		} else {
			return nodeEnv
		}
	}())

	// Initialize content database collections
	contentDb := client.Database(contentDbName)
	ContentCollections = &ContentDBCollections{
		Questions: QuestionCollection{
			collection: contentDb.Collection("problems"), // Note: collection renamed from "questions" to "problems"
		},
		Testcases: TestCasesCollection{
			collection: contentDb.Collection("testcases"),
		},
		Modules: ModulesCollection{
			collection: contentDb.Collection("modules"),
		},
		Projects: ProjectCollection{
			collection: contentDb.Collection("projects"),
		},
	}

	// Initialize app database collections
	appDb := client.Database(activeAppDBName)
	AppCollections = &AppDBCollections{
		ModuleSubmissions: ModuleSubmissionCollection{
			collection: appDb.Collection("module_question_submissions"),
		},
		Users: UsersCollection{
			collection: appDb.Collection("users"),
		},
		UserTests: UserTestsCollection{
			collection: appDb.Collection("user_tests"),
		},
		ReferralApplications: ReferralApplicationsCollection{
			collection: appDb.Collection("referral_applications"),
		},
		ActivityProgress: ActivityProgressCollection{
			collection: appDb.Collection("activity_progress"),
		},
		DecisionTraceSessions: DecisionTraceSessionsCollection{
			collection: appDb.Collection("decision_trace_sessions"),
		},
		DecisionTraceEvents: DecisionTraceEventsCollection{
			collection: appDb.Collection("decision_trace_events"),
		},
	}

	// Create indexes for activity_progress collection (unique compound index for idempotency)
	if err := AppCollections.ActivityProgress.EnsureActivityProgressIndexes(ctx); err != nil {
		log.Printf("⚠️  Warning: Failed to create activity_progress indexes: %v", err)
	} else {
		log.Println("✅ Activity progress indexes ensured")
	}

	// Create indexes for decision_trace_sessions collection
	if err := AppCollections.DecisionTraceSessions.EnsureIndexes(ctx); err != nil {
		log.Printf("⚠️  Warning: Failed to create decision_trace_sessions indexes: %v", err)
	} else {
		log.Println("✅ Decision trace sessions indexes ensured")
	}

	// Create indexes for decision_trace_events collection
	if err := AppCollections.DecisionTraceEvents.EnsureIndexes(ctx); err != nil {
		log.Printf("⚠️  Warning: Failed to create decision_trace_events indexes: %v", err)
	} else {
		log.Println("✅ Decision trace events indexes ensured")
	}

	// Create indexes for user_action_logs collection (user action tracking)
	if err := CreateUserActionIndexes(ctx); err != nil {
		log.Printf("⚠️  Warning: Failed to create user_action_logs indexes: %v", err)
	} else {
		log.Println("✅ User action logs indexes ensured")
	}

	// Create indexes for diffs collection
	CreateDiffIndexes()
	log.Println("✅ Diffs indexes ensured")

	// Create indexes for user_projects collection
	CreateUserProjectIndexes()
	log.Println("✅ User projects indexes ensured")

	// Create indexes for diff_events collection
	CreateDiffEventIndexes()
	log.Println("✅ Diff events indexes ensured")

	// Create indexes for user_profiles collection
	CreateUserProfileIndexes()
	log.Println("✅ User profiles indexes ensured")

	// Create indexes for report_cards collection
	CreateReportCardIndexes()
	log.Println("✅ Report cards indexes ensured")

	// Create indexes for boss fight collections
	CreateBossFightIndexes()
	log.Println("✅ Boss fight indexes ensured")

	// Keep backwards compatibility - Collections now points to a hybrid structure
	// For content operations, use ContentCollections
	// For runtime operations, use AppCollections
	Collections = &DBCollections{
		Questions:         ContentCollections.Questions,
		Testcases:         ContentCollections.Testcases,
		Modules:           ContentCollections.Modules,
		Projects:          ContentCollections.Projects,
		ModuleSubmissions: AppCollections.ModuleSubmissions,
		Users:             AppCollections.Users,
	}
}

// extractClusterHost extracts the cluster hostname from a MongoDB URI, hiding credentials
func extractClusterHost(uri string) string {
	// Format: mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/...
	if idx := strings.Index(uri, "@"); idx != -1 {
		remainder := uri[idx+1:]
		if slashIdx := strings.Index(remainder, "/"); slashIdx != -1 {
			return remainder[:slashIdx]
		}
		if queryIdx := strings.Index(remainder, "?"); queryIdx != -1 {
			return remainder[:queryIdx]
		}
		return remainder
	}
	return "(unable to parse)"
}

// GetDBInfo returns diagnostic information about the current database connection
func GetDBInfo(ctx context.Context) (*DBInfo, error) {
	if MongoClient == nil {
		return nil, fmt.Errorf("MongoDB client not initialized")
	}

	info := &DBInfo{
		ContentDBName: activeContentDBName,
		AppDBName:     activeAppDBName,
		NodeEnv:       activeNodeEnv,
		ClusterHost:   activeClusterHost,
		Collections:   make(map[string]int64),
	}

	// Get collection counts from app DB
	appDb := GetAppDb()
	collections := []string{"users", "browser_submissions", "runner_events", "user_tests"}

	for _, colName := range collections {
		count, err := appDb.Collection(colName).CountDocuments(ctx, bson.M{})
		if err != nil {
			info.Collections[colName] = -1 // Error indicator
		} else {
			info.Collections[colName] = count
		}
	}

	return info, nil
}

// GetActiveAppDBName returns the currently active app database name
func GetActiveAppDBName() string {
	return activeAppDBName
}

// GetActiveNodeEnv returns the current NODE_ENV value
func GetActiveNodeEnv() string {
	return activeNodeEnv
}

// GetDevDb always returns the dev database instance, regardless of NODE_ENV
// Used for routing internal user data away from production metrics
func GetDevDb() *mongo.Database {
	if MongoClient == nil {
		log.Fatal("MongoDB client not initialized. Call ConnectMongoDB() first.")
	}
	if cachedDevDbName == "" {
		log.Printf("WARNING: Dev DB name not cached, falling back to app DB")
		return GetAppDb()
	}
	return MongoClient.Database(cachedDevDbName)
}

// IsInternalUser checks if the email belongs to an internal/admin user
// Internal user data should be routed to dev database to avoid polluting production metrics
func IsInternalUser(email string) bool {
	if email == "" {
		return false
	}
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	return strings.HasSuffix(normalizedEmail, "@linkedinorleftout.com")
}
