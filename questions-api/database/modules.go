package database

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/gerdinv/questions-api/shared"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type ModulesCollection struct {
	collection *mongo.Collection
}

func ToStruct[T any](raw interface{}) (T, error) {
	var out T
	data, err := json.Marshal(raw)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(data, &out)
	return out, err
}

func StructToMap(v interface{}) (map[string]interface{}, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out map[string]interface{}
	err = json.Unmarshal(raw, &out)
	return out, err
}

// extractRefIDFromData tries to get an ObjectID from content.Data (refId, id, or _id).
// Handles multiple formats: string hex, primitive.ObjectID, and extended JSON {"$oid": "..."}
func extractRefIDFromData(data map[string]interface{}) (primitive.ObjectID, bool) {
	if data == nil {
		log.Printf("extractRefIDFromData: data is nil")
		return primitive.NilObjectID, false
	}
	for _, key := range []string{"refId", "id", "_id"} {
		v, ok := data[key]
		if !ok {
			continue
		}
		log.Printf("extractRefIDFromData: found key %q with value type %T", key, v)

		// Try to extract ObjectID from various formats
		if objID, ok := extractObjectID(v); ok {
			return objID, true
		}
	}
	log.Printf("extractRefIDFromData: no valid refId/id/_id found in data")
	return primitive.NilObjectID, false
}

// extractObjectID tries to extract an ObjectID from various formats
func extractObjectID(v interface{}) (primitive.ObjectID, bool) {
	switch val := v.(type) {
	case string:
		// Direct hex string: "68e5fbf409e9802593e32e5e"
		objID, err := primitive.ObjectIDFromHex(val)
		if err == nil {
			return objID, true
		}
	case primitive.ObjectID:
		// Already a primitive.ObjectID
		return val, true
	case map[string]interface{}:
		// Extended JSON format: {"$oid": "68e5fbf409e9802593e32e5e"}
		if oid, ok := val["$oid"]; ok {
			if oidStr, ok := oid.(string); ok {
				objID, err := primitive.ObjectIDFromHex(oidStr)
				if err == nil {
					return objID, true
				}
			}
		}
	}
	return primitive.NilObjectID, false
}

func (m *ModulesCollection) CreateModule(ctx context.Context, data shared.ModulePayload) (string, error) {
	now := time.Now()
	var formattedContentArr []shared.ModuleContentItem

	for _, content := range data.Content {
		content.ID = primitive.NewObjectID().String()

		if content.Type == shared.Question || content.Type == shared.Project {
			refID, ok := extractRefIDFromData(content.Data)
			if !ok {
				log.Printf("Module content type %q missing refId/id/_id in data; frontend should send the existing question/project ID", content.Type)
				return "", fmt.Errorf("content type %q requires refId (or id/_id) in data", content.Type)
			}
			content.RefID = refID
			content.Data = nil
		}
		formattedContentArr = append(formattedContentArr, content)
	}

	moduleDoc := shared.ModuleDocument{
		ID:          primitive.NewObjectID(),
		Title:       data.Title,
		Description: data.Description,
		Content:     formattedContentArr,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	result, err := m.collection.InsertOne(ctx, moduleDoc)
	if err != nil {
		return "", err
	}
	return result.InsertedID.(primitive.ObjectID).Hex(), nil
}

func (m *ModulesCollection) GetAllModules(ctx context.Context) ([]shared.ModuleDocument, error) {
	cursor, err := m.collection.Find(ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var modules []shared.ModuleDocument
	if err := cursor.All(ctx, &modules); err != nil {
		return nil, err
	}

	log.Println("Modules: ", modules)

	return modules, nil
}

func (m *ModulesCollection) GetModuleByID(ctx context.Context, id string) (*shared.ModuleDocument, error) {
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, err
	}

	// Aggregation: match module, unwind content, lookup projects and problems by refId, stitch data back.
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.D{{Key: "_id", Value: objID}}}},
		{{Key: "$unwind", Value: bson.D{
			{Key: "path", Value: "$content"},
			{Key: "preserveNullAndEmptyArrays", Value: true},
		}}},
		{{Key: "$lookup", Value: bson.D{
			{Key: "from", Value: "projects"},
			{Key: "localField", Value: "content.refId"},
			{Key: "foreignField", Value: "_id"},
			{Key: "as", Value: "projectDetails"},
		}}},
		{{Key: "$lookup", Value: bson.D{
			{Key: "from", Value: "problems"},
			{Key: "localField", Value: "content.refId"},
			{Key: "foreignField", Value: "_id"},
			{Key: "as", Value: "questionDetails"},
		}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "content.data", Value: bson.D{
				{Key: "$cond", Value: bson.A{
					bson.D{{Key: "$and", Value: bson.A{
						bson.D{{Key: "$eq", Value: bson.A{"$content.type", string(shared.Project)}}},
						bson.D{{Key: "$gt", Value: bson.A{bson.D{{Key: "$size", Value: "$projectDetails"}}, 0}}},
					}}},
					bson.D{{Key: "$arrayElemAt", Value: bson.A{"$projectDetails", 0}}},
					bson.D{{Key: "$cond", Value: bson.A{
						bson.D{{Key: "$and", Value: bson.A{
							bson.D{{Key: "$eq", Value: bson.A{"$content.type", string(shared.Question)}}},
							bson.D{{Key: "$gt", Value: bson.A{bson.D{{Key: "$size", Value: "$questionDetails"}}, 0}}},
						}}},
						bson.D{{Key: "$arrayElemAt", Value: bson.A{"$questionDetails", 0}}},
						"$content.data",
					}}},
				}},
			}},
		}}},
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$_id"},
			{Key: "title", Value: bson.D{{Key: "$first", Value: "$title"}}},
			{Key: "description", Value: bson.D{{Key: "$first", Value: "$description"}}},
			{Key: "createdAt", Value: bson.D{{Key: "$first", Value: "$createdAt"}}},
			{Key: "updatedAt", Value: bson.D{{Key: "$first", Value: "$updatedAt"}}},
			{Key: "content", Value: bson.D{{Key: "$push", Value: "$content"}}},
		}}},
	}

	cursor, err := m.collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	if !cursor.Next(ctx) {
		return nil, mongo.ErrNoDocuments
	}

	var module shared.ModuleDocument
	if err := cursor.Decode(&module); err != nil {
		return nil, err
	}

	// Inject test case names for question content (same as before)
	for i := range module.Content {
		if module.Content[i].Type != shared.Question || module.Content[i].Data == nil {
			continue
		}
		question, err := ToStruct[shared.QuestionDocument](module.Content[i].Data)
		if err != nil {
			continue
		}
		for j := range question.Testcases {
			question.Testcases[j].TestName = fmt.Sprintf("Test case %d", j+1)
		}
		updatedData, err := StructToMap(question)
		if err != nil {
			continue
		}
		module.Content[i].Data = updatedData
	}

	return &module, nil
}

func (m *ModulesCollection) UpdateModule(ctx context.Context, id string, payload shared.UpdateModulePayload) error {
	objID, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid module ID: %w", err)
	}

	updateFields := bson.M{
		"updatedAt": time.Now(), // Always update timestamp
	}

	// Conditionally add fields to the update document
	if payload.Title != nil {
		updateFields["title"] = *payload.Title
	}

	if payload.Description != nil {
		updateFields["description"] = *payload.Description
	}

	if payload.Content != nil {
		formattedContent := make([]shared.ModuleContentItem, len(*payload.Content))

		for i, content := range *payload.Content {
			if content.Type == shared.Question || content.Type == shared.Project {
				log.Printf("UpdateModule: Processing content[%d] type=%q, existing RefID=%s, Data keys: %v", i, content.Type, content.RefID.Hex(), getMapKeys(content.Data))

				// First, try to use existing RefID if it's already set (from when module was loaded)
				// Only extract from data if RefID is not set (e.g., newly added content item)
				if content.RefID.IsZero() {
					refID, ok := extractRefIDFromData(content.Data)
					if !ok {
						log.Printf("UpdateModule: content[%d] type %q has no RefID and missing refId/id/_id in data. Data: %+v", i, content.Type, content.Data)
						return fmt.Errorf("content type %q at index %d requires refId (or id/_id) in data", content.Type, i)
					}
					log.Printf("UpdateModule: content[%d] extracted refID from data: %s", i, refID.Hex())
					content.RefID = refID
				} else {
					log.Printf("UpdateModule: content[%d] using existing refID: %s", i, content.RefID.Hex())
				}
				content.Data = nil
			}
			if content.ID == "" {
				content.ID = primitive.NewObjectID().String()
			}
			formattedContent[i] = content
		}

		updateFields["content"] = formattedContent
	}

	// Perform the update
	_, err = m.collection.UpdateOne(ctx, bson.M{"_id": objID}, bson.M{"$set": updateFields})
	if err != nil {
		log.Printf("Error updating module with ID %s: %+v\n", id, err)
		return fmt.Errorf("failed to update module: %w", err)
	}

	return nil
}

// getMapKeys returns the keys of a map for logging purposes
func getMapKeys(m map[string]interface{}) []string {
	if m == nil {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func (m *ModulesCollection) DeleteModule(ctx context.Context, moduleId string) (bool, error) {
	objID, err := primitive.ObjectIDFromHex(moduleId)
	if err != nil {
		return false, err
	}

	result, err := m.collection.DeleteOne(ctx, bson.M{"_id": objID})
	if err != nil {
		return false, err
	}

	return result.DeletedCount > 0, nil
}
