package database

import (
	"context"
	"time"

	"github.com/gerdinv/questions-api/shared"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ActivityProgressCollection handles database operations for activity progress tracking
type ActivityProgressCollection struct {
	collection *mongo.Collection
}

// NewActivityProgressCollection creates a new ActivityProgressCollection
func NewActivityProgressCollection(db *mongo.Database, collectionName string) *ActivityProgressCollection {
	return &ActivityProgressCollection{
		collection: db.Collection(collectionName),
	}
}

// UpsertActivityProgress marks an activity as complete for a user.
// Uses upsert to ensure idempotency - calling multiple times won't create duplicates.
// Filter: email + moduleId + activityId (the unique compound key)
// Update: $set completedAt to current time (or keeps existing if already set)
func (c *ActivityProgressCollection) UpsertActivityProgress(ctx context.Context, doc shared.ActivityProgressDocument) error {
	// Route internal users to dev database to avoid polluting production metrics
	var collection *mongo.Collection
	if IsInternalUser(doc.Email) {
		collection = GetDevDb().Collection("activity_progress")
	} else {
		collection = c.collection
	}

	filter := bson.M{
		"email":      doc.Email,
		"moduleId":   doc.ModuleID,
		"activityId": doc.ActivityID,
	}

	// Use $setOnInsert for completedAt so we preserve the original completion time
	// if the record already exists (true idempotency)
	update := bson.M{
		"$setOnInsert": bson.M{
			"email":       doc.Email,
			"moduleId":    doc.ModuleID,
			"activityId":  doc.ActivityID,
			"completedAt": time.Now(),
		},
	}

	opts := options.Update().SetUpsert(true)
	_, err := collection.UpdateOne(ctx, filter, update, opts)
	return err
}

// GetProgressForModule returns a list of completed activity IDs for a specific module and user.
func (c *ActivityProgressCollection) GetProgressForModule(ctx context.Context, email, moduleId string) ([]string, error) {
	// Route internal users to dev database
	var collection *mongo.Collection
	if IsInternalUser(email) {
		collection = GetDevDb().Collection("activity_progress")
	} else {
		collection = c.collection
	}

	filter := bson.M{
		"email":    email,
		"moduleId": moduleId,
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var activityIds []string
	for cursor.Next(ctx) {
		var doc shared.ActivityProgressDocument
		if err := cursor.Decode(&doc); err != nil {
			continue // Skip malformed documents
		}
		activityIds = append(activityIds, doc.ActivityID)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	// Return empty slice instead of nil for consistent JSON serialization
	if activityIds == nil {
		activityIds = []string{}
	}

	return activityIds, nil
}

// GetAllUserProgress returns a map of moduleId -> list of completed activityIds for a user.
// This is used by the modules list page to show progress across all modules.
func (c *ActivityProgressCollection) GetAllUserProgress(ctx context.Context, email string) (map[string][]string, error) {
	// Route internal users to dev database
	var collection *mongo.Collection
	if IsInternalUser(email) {
		collection = GetDevDb().Collection("activity_progress")
	} else {
		collection = c.collection
	}

	filter := bson.M{
		"email": email,
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	progressMap := make(map[string][]string)
	for cursor.Next(ctx) {
		var doc shared.ActivityProgressDocument
		if err := cursor.Decode(&doc); err != nil {
			continue // Skip malformed documents
		}
		progressMap[doc.ModuleID] = append(progressMap[doc.ModuleID], doc.ActivityID)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	return progressMap, nil
}

// EnsureActivityProgressIndexes creates the required indexes for the activity_progress collection.
// This should be called during application startup.
func (c *ActivityProgressCollection) EnsureActivityProgressIndexes(ctx context.Context) error {
	// Unique compound index on (email, moduleId, activityId) for idempotency
	indexModel := mongo.IndexModel{
		Keys: bson.D{
			{Key: "email", Value: 1},
			{Key: "moduleId", Value: 1},
			{Key: "activityId", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	}

	_, err := c.collection.Indexes().CreateOne(ctx, indexModel)
	return err
}
