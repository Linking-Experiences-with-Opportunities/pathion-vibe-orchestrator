package database

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// SessionArtifactDocument is the stored representation of a session summary + optional artifact bundle
type SessionArtifactDocument struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"_id"`
	UserID    string             `bson:"userId" json:"userId"`
	Email     string             `bson:"email,omitempty" json:"email,omitempty"`
	SessionID string             `bson:"sessionId" json:"sessionId"`
	ProjectID string             `bson:"projectId,omitempty" json:"projectId,omitempty"`
	ProblemID string             `bson:"problemId,omitempty" json:"problemId,omitempty"`
	Summary   bson.M             `bson:"summary" json:"summary"` // SessionSummary as flexible map
	Artifact  bson.M             `bson:"artifact,omitempty" json:"artifact,omitempty"`
	CreatedAt time.Time          `bson:"createdAt" json:"createdAt"`
}

// GetSessionArtifactsCollection returns the session_artifacts collection from app DB
func GetSessionArtifactsCollection() *mongo.Collection {
	return GetAppDb().Collection("session_artifacts")
}

// GetDevSessionArtifactsCollection returns the session_artifacts collection from dev DB.
func GetDevSessionArtifactsCollection() *mongo.Collection {
	return GetDevDb().Collection("session_artifacts")
}

func getSessionArtifactsCollectionForUser(email string) *mongo.Collection {
	if IsInternalUser(email) {
		return GetDevSessionArtifactsCollection()
	}
	return GetSessionArtifactsCollection()
}

// CreateSessionArtifact inserts a session artifact document
func CreateSessionArtifact(ctx context.Context, doc *SessionArtifactDocument) error {
	if doc.CreatedAt.IsZero() {
		doc.CreatedAt = time.Now()
	}
	_, err := getSessionArtifactsCollectionForUser(doc.Email).InsertOne(ctx, doc)
	return err
}

// ListSessionArtifactsForUser returns recent session artifacts for one user ordered by newest first.
func ListSessionArtifactsForUser(ctx context.Context, userID, email string, limit int64) ([]SessionArtifactDocument, error) {
	if limit <= 0 {
		limit = 20
	}
	collection := getSessionArtifactsCollectionForUser(email)
	filter := bson.M{"userId": userID}
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(limit)

	cursor, err := collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	out := make([]SessionArtifactDocument, 0, limit)
	for cursor.Next(ctx) {
		var doc SessionArtifactDocument
		if err := cursor.Decode(&doc); err != nil {
			return nil, err
		}
		out = append(out, doc)
	}
	if err := cursor.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
