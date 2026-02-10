package database

import (
	"context"
	"errors"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// UserReportCardsDocument stores all report-card entries for one user.
type UserReportCardsDocument struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"_id"`
	UserID    string             `bson:"userId" json:"userId"`
	Email     string             `bson:"email,omitempty" json:"email,omitempty"`
	Reports   []ReportCardEntry  `bson:"reports" json:"reports"`
	CreatedAt time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time          `bson:"updatedAt" json:"updatedAt"`
}

// ReportCardEntry is one saved paragraphic report and its lifecycle state.
type ReportCardEntry struct {
	ReportID    string                 `bson:"reportId" json:"reportId"`
	Paragraph   string                 `bson:"paragraph" json:"paragraph"`
	Status      string                 `bson:"status" json:"status"` // active | archived
	Source      map[string]interface{} `bson:"source,omitempty" json:"source,omitempty"`
	Interpreted *InterpretedReportCard `bson:"interpreted,omitempty" json:"interpreted,omitempty"`
	Revisions   []ReportCardRevision   `bson:"revisions,omitempty" json:"revisions,omitempty"`
	CreatedAt   time.Time              `bson:"createdAt" json:"createdAt"`
	UpdatedAt   time.Time              `bson:"updatedAt" json:"updatedAt"`
}

// ReportCardRevision stores a prior paragraph version.
type ReportCardRevision struct {
	RevisionID string    `bson:"revisionId" json:"revisionId"`
	Paragraph  string    `bson:"paragraph" json:"paragraph"`
	Reason     string    `bson:"reason,omitempty" json:"reason,omitempty"`
	CreatedAt  time.Time `bson:"createdAt" json:"createdAt"`
}

// InterpretedReportCard is a deterministic structured card derived from paragraphic reports.
type InterpretedReportCard struct {
	Version              string                  `bson:"version" json:"version"`
	GeneratedAt          time.Time               `bson:"generatedAt" json:"generatedAt"`
	Summary              string                  `bson:"summary" json:"summary"`
	Habits               []string                `bson:"habits" json:"habits"`
	Strengths            []string                `bson:"strengths" json:"strengths"`
	FallbackPatterns     []string                `bson:"fallbackPatterns" json:"fallbackPatterns"`
	RiskAreas            []string                `bson:"riskAreas" json:"riskAreas"`
	DebuggingStyle       []string                `bson:"debuggingStyle" json:"debuggingStyle"`
	NarrativeReliability string                  `bson:"narrativeReliability" json:"narrativeReliability"`
	Evidence             ReportCardEvidenceStats `bson:"evidence" json:"evidence"`
}

// ReportCardEvidenceStats carries deterministic evidence used for interpretation.
type ReportCardEvidenceStats struct {
	SessionCount       int     `bson:"sessionCount" json:"sessionCount"`
	FullPassRate       float64 `bson:"fullPassRate" json:"fullPassRate"`
	AverageRuns        float64 `bson:"averageRuns" json:"averageRuns"`
	NarrativeFlagCount int     `bson:"narrativeFlagCount" json:"narrativeFlagCount"`
}

var ErrReportNotFound = errors.New("report not found")

func GetReportCardsCollection() *mongo.Collection {
	return GetAppDb().Collection("report_cards")
}

func GetDevReportCardsCollection() *mongo.Collection {
	return GetDevDb().Collection("report_cards")
}

func getReportCardsCollectionForUser(email string) *mongo.Collection {
	if IsInternalUser(email) {
		return GetDevReportCardsCollection()
	}
	return GetReportCardsCollection()
}

func GetUserReportCards(ctx context.Context, userID, email string) (*UserReportCardsDocument, error) {
	collection := getReportCardsCollectionForUser(email)
	var doc UserReportCardsDocument
	err := collection.FindOne(ctx, bson.M{"userId": userID}).Decode(&doc)
	if err != nil {
		return nil, err
	}
	sortReportsNewestFirst(doc.Reports)
	return &doc, nil
}

func AppendReportCard(ctx context.Context, userID, email string, entry ReportCardEntry) error {
	collection := getReportCardsCollectionForUser(email)
	now := time.Now()

	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = now
	}
	entry.UpdatedAt = now
	if entry.Status == "" {
		entry.Status = "active"
	}

	filter := bson.M{"userId": userID}
	update := bson.M{
		"$setOnInsert": bson.M{
			"userId":    userID,
			"email":     email,
			"createdAt": now,
			"reports":   []ReportCardEntry{},
		},
		"$set": bson.M{
			"updatedAt": now,
			"email":     email,
		},
		"$push": bson.M{
			"reports": entry,
		},
	}

	_, err := collection.UpdateOne(ctx, filter, update, options.Update().SetUpsert(true))
	return err
}

func ReviseReportCard(ctx context.Context, userID, email, reportID, newParagraph, reason string) (*ReportCardEntry, error) {
	doc, err := GetUserReportCards(ctx, userID, email)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	updated := false
	for i := range doc.Reports {
		if doc.Reports[i].ReportID != reportID {
			continue
		}
		rev := ReportCardRevision{
			RevisionID: primitive.NewObjectID().Hex(),
			Paragraph:  doc.Reports[i].Paragraph,
			Reason:     reason,
			CreatedAt:  now,
		}
		doc.Reports[i].Revisions = append([]ReportCardRevision{rev}, doc.Reports[i].Revisions...)
		doc.Reports[i].Paragraph = newParagraph
		doc.Reports[i].UpdatedAt = now
		updated = true
		break
	}
	if !updated {
		return nil, ErrReportNotFound
	}

	doc.UpdatedAt = now
	if err := replaceUserReportCards(ctx, email, doc); err != nil {
		return nil, err
	}

	for i := range doc.Reports {
		if doc.Reports[i].ReportID == reportID {
			return &doc.Reports[i], nil
		}
	}
	return nil, ErrReportNotFound
}

func SetReportInterpretedCard(ctx context.Context, userID, email, reportID string, interpreted InterpretedReportCard) (*ReportCardEntry, error) {
	doc, err := GetUserReportCards(ctx, userID, email)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	updated := false
	for i := range doc.Reports {
		if doc.Reports[i].ReportID != reportID {
			continue
		}
		doc.Reports[i].Interpreted = &interpreted
		doc.Reports[i].UpdatedAt = now
		updated = true
		break
	}
	if !updated {
		return nil, ErrReportNotFound
	}

	doc.UpdatedAt = now
	if err := replaceUserReportCards(ctx, email, doc); err != nil {
		return nil, err
	}

	for i := range doc.Reports {
		if doc.Reports[i].ReportID == reportID {
			return &doc.Reports[i], nil
		}
	}
	return nil, ErrReportNotFound
}

func SetReportStatus(ctx context.Context, userID, email, reportID, status string) (*ReportCardEntry, error) {
	doc, err := GetUserReportCards(ctx, userID, email)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	updated := false
	for i := range doc.Reports {
		if doc.Reports[i].ReportID != reportID {
			continue
		}
		doc.Reports[i].Status = status
		doc.Reports[i].UpdatedAt = now
		updated = true
		break
	}
	if !updated {
		return nil, ErrReportNotFound
	}

	doc.UpdatedAt = now
	if err := replaceUserReportCards(ctx, email, doc); err != nil {
		return nil, err
	}

	for i := range doc.Reports {
		if doc.Reports[i].ReportID == reportID {
			return &doc.Reports[i], nil
		}
	}
	return nil, ErrReportNotFound
}

func replaceUserReportCards(ctx context.Context, email string, doc *UserReportCardsDocument) error {
	collection := getReportCardsCollectionForUser(email)
	_, err := collection.ReplaceOne(ctx, bson.M{"userId": doc.UserID}, doc, options.Replace().SetUpsert(true))
	return err
}

func sortReportsNewestFirst(reports []ReportCardEntry) {
	sort.SliceStable(reports, func(i, j int) bool {
		return reports[i].CreatedAt.After(reports[j].CreatedAt)
	})
}

func CreateReportCardIndexes() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	indexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "userId", Value: 1}},
			Options: options.Index().SetUnique(true),
		},
		{
			Keys: bson.D{{Key: "reports.reportId", Value: 1}},
		},
		{
			Keys: bson.D{{Key: "updatedAt", Value: -1}},
		},
	}

	for _, coll := range []*mongo.Collection{GetReportCardsCollection(), GetDevReportCardsCollection()} {
		if _, err := coll.Indexes().CreateMany(ctx, indexes); err != nil {
			continue
		}
	}
}
