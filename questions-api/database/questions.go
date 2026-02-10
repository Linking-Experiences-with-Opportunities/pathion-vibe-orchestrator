package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/gerdinv/questions-api/shared"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type QuestionCollection struct {
	collection *mongo.Collection
}

// this is a helper that returns the next question number
func getNextQuestionNumber(ctx context.Context, db *mongo.Database, name string) (int, error) {
	filter := bson.M{"_id": name}
	update := bson.M{"$inc": bson.M{"seq": 1}}
	opts := options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)

	var result struct {
		Seq int `bson:"seq"`
	}
	err := db.Collection("counters").FindOneAndUpdate(ctx, filter, update, opts).Decode(&result)
	if err != nil {
		return 0, err
	}
	return result.Seq, nil
}

func (q *QuestionCollection) CreateQuestion(ctx context.Context, data shared.QuestionPayload) (string, error) {
	now := time.Now()

	questionNumber, err := getNextQuestionNumber(ctx, q.collection.Database(), "questionNumber")
	if err != nil {
		return "", err
	}

	var testcases []shared.TestCaseDocument
	now = time.Now()
	for _, tc := range data.TestCases {
		testcases = append(testcases, shared.TestCaseDocument{
			QuestionNumber: questionNumber,
			Input:          tc.Input,
			ExpectedOutput: tc.ExpectedOutput,
			CreatedAt:      now,
			UpdatedAt:      now,
		})
	}

	doc := shared.QuestionDocument{
		QuestionNumber: questionNumber,
		Description:    data.Description,
		CodeSnippet:    data.CodeSnippet,
		Driver:         data.Driver,
		Difficulty:     data.Difficulty,
		Likes:          0,
		Dislikes:       0,
		Testcases:      testcases,
		Title:          data.Title,
		MethodName:     data.MethodName,
		ClassName:      data.ClassName,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	result, err := q.collection.InsertOne(ctx, doc)
	if err != nil {
		return "", err
	}
	return result.InsertedID.(primitive.ObjectID).Hex(), nil
}

func (q *QuestionCollection) GetQuestionByID(ctx context.Context, id string) (*shared.QuestionDocument, error) {
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, err
	}

	var question shared.QuestionDocument
	err = q.collection.FindOne(ctx, bson.M{"_id": objID}).Decode(&question)
	if err != nil {
		return nil, err
	}

	for i, _ := range question.Testcases {
		question.Testcases[i].TestName = fmt.Sprintf("Test case %d", i+1)
	}

	return &question, nil
}

func (q *QuestionCollection) GetQuestionByNumber(ctx context.Context, number int) (*shared.QuestionDocument, error) {
	var question shared.QuestionDocument
	err := q.collection.FindOne(ctx, bson.M{"questionNumber": number}).Decode(&question)
	if err != nil {
		return nil, err
	}

	for i, _ := range question.Testcases {
		question.Testcases[i].TestName = fmt.Sprintf("Test case %d", i+1)
	}

	return &question, nil
}

func (q *QuestionCollection) UpdateLikesDislikes(ctx context.Context, id string, likes int, dislikes int) (bool, error) {
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return false, err
	}

	update := bson.M{
		"$set": bson.M{
			"likes":     likes,
			"dislikes":  dislikes,
			"updatedAt": time.Now(),
		},
	}

	result, err := q.collection.UpdateOne(ctx, bson.M{"_id": objID}, update)
	if err != nil {
		return false, err
	}

	return result.ModifiedCount > 0, nil
}

// GetAllQuestions is a convenience wrapper
// Reads from content DB
func GetAllQuestions() ([]shared.QuestionDocument, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return ContentCollections.Questions.GetAllQuestions(ctx)
}

// GetQuestionByNumber is a convenience wrapper
// Reads from content DB
func GetQuestionByNumber(questionNumber int) (*shared.QuestionDocument, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return ContentCollections.Questions.GetQuestionByNumber(ctx, questionNumber)
}

func (q *QuestionCollection) GetAllQuestions(ctx context.Context) ([]shared.QuestionDocument, error) {
	// OPTIONAL: Sort by questionNumber so the dropdown is ordered
	opts := options.Find().SetSort(bson.D{{Key: "questionNumber", Value: 1}})

	cursor, err := q.collection.Find(ctx, bson.D{}, opts) // <--- Add opts here
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var questions []shared.QuestionDocument
	if err := cursor.All(ctx, &questions); err != nil {
		return nil, err
	}

	return questions, nil
}

func (q *QuestionCollection) AddTestCasesToQuestion(ctx context.Context, payloads []shared.TestCasePayload) (bool, error) {
	if len(payloads) == 0 {
		return false, errors.New("no test cases provided")
	}

	now := time.Now()
	var testCases []shared.TestCaseDocument
	questionNumber := payloads[0].QuestionNumber // assume all test cases are for the same question

	for _, p := range payloads {
		testCases = append(testCases, shared.TestCaseDocument{
			QuestionNumber: p.QuestionNumber,
			Input:          p.Input,
			ExpectedOutput: p.ExpectedOutput,
			CreatedAt:      now,
			UpdatedAt:      now,
		})
	}

	update := bson.M{
		"$push": bson.M{
			"testcases": bson.M{
				"$each": testCases,
			},
		},
		"$set": bson.M{
			"updatedAt": now,
		},
	}

	result, err := q.collection.UpdateOne(ctx, bson.M{
		"questionNumber": questionNumber,
	}, update)

	if err != nil {
		return false, err
	}

	return result.ModifiedCount > 0, nil
}
