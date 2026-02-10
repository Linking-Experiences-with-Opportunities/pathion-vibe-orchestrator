package shared

import (
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// NormalizeEmail returns a lowercase, trimmed version of the email for consistent querying
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// IsInternalUser checks if the email belongs to an internal/admin user
// Internal user data should be routed to dev database
func IsInternalUser(email string) bool {
	if email == "" {
		return false
	}
	return strings.HasSuffix(NormalizeEmail(email), "@linkedinorleftout.com")
}

type QuestionDocument struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	QuestionNumber int                `bson:"questionNumber" json:"questionNumber"`
	Description    string             `bson:"description" json:"description"`
	CodeSnippet    string             `bson:"codeSnippet" json:"codeSnippet"`
	Driver         string             `bson:"driver" json:"driver"`
	Difficulty     DifficultyType     `bson:"difficulty" json:"difficulty"`
	Likes          int                `bson:"likes" json:"likes"`
	Dislikes       int                `bson:"dislikes" json:"dislikes"`
	Testcases      []TestCaseDocument `bson:"testcases" json:"testcases"`
	Title          string             `bson:"title" json:"title"`
	MethodName     string             `bson:"methodName" json:"functionName"` // Note: JSON uses functionName for frontend compatibility
	ClassName      string             `bson:"className" json:"className"`
	CreatedAt      time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt      time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type DifficultyType string

const (
	DifficultyEasy   DifficultyType = "easy"
	DifficultyMedium DifficultyType = "medium"
	DifficultyHard   DifficultyType = "hard"
)

type QuestionPayload struct {
	ID          *primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Description string              `bson:"description" json:"description"`
	CodeSnippet string              `bson:"code_snippet" json:"code_snippet"`
	TestCases   []GenericTestCase   `bson:"testcases" json:"testcases"`
	Difficulty  DifficultyType      `bson:"difficulty" json:"difficulty"`
	Title       string              `bson:"title" json:"title"`
	Driver      string              `bson:"driver" json:"driver"`
	MethodName  string              `bson:"methodName" json:"methodName"`
	ClassName   string              `bson:"className" json:"className"`
}

type GenericTestCase struct {
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output"`
}

type TestCaseDocument struct {
	QuestionNumber int       `bson:"question_number" json:"QuestionNumber"`
	Input          string    `bson:"input" json:"input"`
	ExpectedOutput string    `bson:"expected_output" json:"expected_output"`
	CreatedAt      time.Time `bson:"created_at" json:"CreatedAt"`
	UpdatedAt      time.Time `bson:"updated_at" json:"UpdatedAt"`
	// Fields below will be included in JSON responses but will be ignored by MongoDB
	TestName string `bson:"-" json:"Name"`
}

type TestCasePayload struct {
	QuestionNumber int    `bson:"question_number" json:"question_number"`
	Input          string `bson:"input" json:"input"`
	ExpectedOutput string `bson:"expected_output" json:"expectedOutput"`
}

type TestCase interface {
	GetInput() string
	GetExpectedOutput() string
	GetQuestionNumber() int
}

func (t TestCasePayload) GetInput() string {
	return t.Input
}

func (t TestCasePayload) GetExpectedOutput() string {
	return t.ExpectedOutput
}

func (t TestCasePayload) GetQuestionNumber() int {
	return t.QuestionNumber
}

func (t TestCaseDocument) GetInput() string {
	return t.Input
}

func (t TestCaseDocument) GetExpectedOutput() string {
	return t.ExpectedOutput
}

func (t TestCaseDocument) GetQuestionNumber() int {
	return t.QuestionNumber
}

type RunTestCasePayload struct {
	TestCaseNumber int    `json:"testCaseNumber"`
	RunAllCases    bool   `json:"runAllCases"`
	LanguageID     int    `json:"languageID"`
	SourceCode     string `json:"sourceCode"`
}

type RunModuleTestCasePayload struct {
	TestCaseNumber int    `json:"testCaseNumber"`
	RunAllCases    bool   `json:"runAllCases"`
	LanguageID     int    `json:"languageID"`
	SourceCode     string `json:"sourceCode"`
	ContentIndex   int    `json:"contentIndex"`
}

type BaseTestCasePayload interface {
	GetTestCaseNumber() int
	GetRunAllCases() bool
}

func (p RunTestCasePayload) GetTestCaseNumber() int {
	return p.TestCaseNumber
}
func (p RunTestCasePayload) GetRunAllCases() bool {
	return p.RunAllCases
}

func (p RunModuleTestCasePayload) GetTestCaseNumber() int {
	return p.TestCaseNumber
}
func (p RunModuleTestCasePayload) GetRunAllCases() bool {
	return p.RunAllCases
}

type GetQuestionResponse struct {
	Question  *QuestionDocument  `bson:"question" json:"question"`
	Testcases []TestCaseDocument `bson:"testcases" json:"testcases"`
}

type SubmissionDocument struct {
	ID               primitive.ObjectID            `bson:"_id,omitempty"`
	Email            string                        `bson:"email"`
	SourceCode       string                        `bson:"sourceCode"`
	LanguageID       int                           `bson:"languageId"`
	QuestionNumber   int                           `bson:"questionNumber"`
	QuestionsCorrect int                           `bson:"questionsCorrect"`
	Result           []CodeExecutionTestCaseResult `bson:"result"`
	CreatedAt        time.Time                     `bson:"createdAt"`
	// Fields below will be included in JSON responses but will be ignored by MongoDB
	HasSolvedProblem bool `bson:"-" json:"HasSolvedProblem"`
}

type ModuleSubmissionDocument struct {
	ID                 primitive.ObjectID            `bson:"_id,omitempty"`
	Email              string                        `bson:"email"`
	SourceCode         string                        `bson:"sourceCode"`
	LanguageID         int                           `bson:"languageId"`
	PassedAllTestcases bool                          `bson:"passedAllTestcases"`
	ModuleContentID    string                        `bson:"moduleContentID" json:"moduleContentID"`
	QuestionsCorrect   int                           `bson:"questionsCorrect"`
	Result             []CodeExecutionTestCaseResult `bson:"result"`
	CreatedAt          time.Time                     `bson:"createdAt"`
}

// ActivityProgressDocument tracks completion of curriculum activities (readings, lectures, etc.)
// Uses a composite key of (Email, ModuleID, ActivityID) for unique identification.
// This is separate from ModuleSubmissionDocument which tracks code problem submissions.
type ActivityProgressDocument struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Email       string             `bson:"email" json:"email"`
	ModuleID    string             `bson:"moduleId" json:"moduleId"`
	ActivityID  string             `bson:"activityId" json:"activityId"` // Index as string: "0", "1", etc.
	CompletedAt time.Time          `bson:"completedAt" json:"completedAt"`
}

// MarkActivityCompletePayload is the request body for marking an activity as complete
type MarkActivityCompletePayload struct {
	ActivityID string `json:"activityId"`
}

type UserDocument struct {
	ID              primitive.ObjectID `bson:"_id,omitempty"`
	SupabaseUserID  string             `bson:"supabaseUserId,omitempty" json:"supabaseUserId,omitempty"` // Supabase UUID
	Name            string             `bson:"name"`
	Image           string             `bson:"image"`
	EmailVerified   *time.Time         `bson:"emailVerified,omitempty"`
	Email           string             `bson:"email"`
	EmailNormalized string             `bson:"emailNormalized,omitempty" json:"emailNormalized,omitempty"` // Lowercase, trimmed
}

type SubmissionPayload struct {
	Email          string   `json:"email"`
	SourceCode     string   `json:"source_code"`
	LanguageID     int      `json:"language_id"`
	ExpectedOutput []string `json:"expected_output"` // not used anymore
}

type ModuleQuestionSubmissionPayload struct {
	Email        string `json:"email"`
	SourceCode   string `json:"source_code"`
	LanguageID   int    `json:"language_id"`
	ContentIndex int    `json:"content_index"`
}

type CodeSubmissionStatus string

const (
	CodeSubmissionPassed CodeSubmissionStatus = "passed"
	CodeSubmissionFailed CodeSubmissionStatus = "failed"
)

// UserClaims represents custom claims decoded from a Supabase JWT token
type UserClaims struct {
	UserID string `json:"sub"` // Supabase uses "sub" (subject) for user UUID
	Email  string `json:"email"`
	Role   string `json:"role,omitempty"`
	Issuer string `json:"iss"`
	//SessionID string `json:"session_id,omitempty"`
	// You can add more fields as needed based on your JWT
}

type CodeExecutionTestCaseResult struct {
	Case    int                  `json:"case"`    // test case number
	Status  CodeSubmissionStatus `json:"status"`  // "passed", "failed"
	Message string               `json:"message"` // optional message
	Printed string               `json:"printed"` // what the user has printed
}

type TestResult struct {
	Name         string      `json:"name"`
	Expected     interface{} `json:"expected"`
	Actual       interface{} `json:"actual"`
	ErrorMessage string      `json:"errorMessage"`
	Passed       bool        `json:"passed"`
	Printed      string      `json:"printed"` // what the user has printed
}

type RunTestCasesForAdminPayload struct {
	SourceCode     string            `json:"sourceCode"`
	LanguageID     int               `json:"languageID"`
	ExpectedOutput []string          `json:"expectedOutput"`
	TestCases      []TestCasePayload `json:"testCases"`
}

type SummarizedStat struct {
	Title                string  `json:"title"`
	Description          string  `json:"description"`
	DescriptionSecondary *string `json:"descriptionSecondary,omitempty"`
	Progress             *int    `json:"progress,omitempty"`
}

type UserSuggestion struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"` // student, admin, etc
}

type UserSubmissionSummary struct {
	TotalSubmissions                  int `json:"totalSubmissions"`
	TotalQuestionsAnsweredCorrectly   int `json:"totalQuestionsAnsweredCorrectly"`
	TotalQuestionsAnsweredIncorrectly int `json:"totalQuestionsAnsweredIncorrectly"`
}

type ContentType string

const (
	Text     ContentType = "text"
	Question ContentType = "question"
	Video    ContentType = "video"
	Project  ContentType = "project"
)

type ModuleContentItem struct {
	ID    string                 `bson:"_id,omitempty" json:"id"`
	Type  ContentType            `json:"type"`
	RefID primitive.ObjectID     `bson:"refId,omitempty" json:"refId,omitempty"`
	Data  map[string]interface{} `json:"data"`
}

type ModulePayload struct {
	Title       string
	Description string
	Content     []ModuleContentItem
}

type UpdateModulePayload struct {
	Title       *string              `json:"title,omitempty"`
	Description *string              `json:"description,omitempty"`
	Content     *[]ModuleContentItem `json:"content,omitempty"`
}

type ModuleDocument struct {
	ID          primitive.ObjectID  `bson:"_id,omitempty"`
	Title       string              `bson:"title" json:"title"`
	Description string              `bson:"description" json:"description"`
	Content     []ModuleContentItem `bson:"content" json:"content"`
	CreatedAt   time.Time           `bson:"createdAt"`
	UpdatedAt   time.Time           `bson:"updatedAt"`
}

// Project models for data structure implementation projects
type ProjectDocument struct {
	ID            primitive.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	ProjectNumber int                `bson:"projectNumber" json:"projectNumber"`
	Title         string             `bson:"title" json:"title"`
	Description   string             `bson:"description" json:"description"`
	Difficulty    DifficultyType     `bson:"difficulty" json:"difficulty"`
	Instructions  string             `bson:"instructions" json:"instructions"`
	StarterFiles  map[string]string  `bson:"starterFiles" json:"starterFiles"`
	TestFile      ProjectTestFile    `bson:"testFile" json:"testFile"`
	Category      string             `bson:"category" json:"category"`
	Tags          []string           `bson:"tags" json:"tags"`
	CreatedAt     time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt     time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type ProjectTestFile struct {
	Filename string `bson:"filename" json:"filename"`
	Content  string `bson:"content" json:"content"`
}

type ProjectPayload struct {
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	Difficulty   DifficultyType    `json:"difficulty"`
	Instructions string            `json:"instructions"`
	StarterFiles map[string]string `json:"starterFiles"`
	TestFile     ProjectTestFile   `json:"testFile"`
	Category     string            `json:"category"`
	Tags         []string          `json:"tags"`
}

// Admin Analytics Models

type UserDetailedMetrics struct {
	Email             string                  `json:"email"`
	Name              string                  `json:"name"`
	Role              string                  `json:"role"`
	ProjectStats      UserProjectStats        `json:"projectStats"`
	RecentSubmissions []RecentSubmission      `json:"recentSubmissions"`
	ProjectAttempts   []ProjectAttemptMetrics `json:"projectAttempts"`
	LastSeenBrowser   string                  `json:"lastSeenBrowser"`
	LastSeenOS        string                  `json:"lastSeenOS"`
	LastSeenDevice    string                  `json:"lastSeenDevice"`
}

type UserProjectStats struct {
	TotalProjects      int `json:"totalProjects"`
	CompletedProjects  int `json:"completedProjects"`
	InProgressProjects int `json:"inProgressProjects"`
	TotalSubmissions   int `json:"totalSubmissions"`
}

type RecentSubmission struct {
	ID           string      `json:"_id"`
	ProblemID    string      `json:"problemId"`
	ProjectTitle string      `json:"projectTitle"`
	CreatedAt    time.Time   `json:"createdAt"`
	Passed       bool        `json:"passed"`
	TestSummary  TestSummary `json:"testSummary"`
}

type TestSummary struct {
	Total  int `json:"total"`
	Passed int `json:"passed"`
	Failed int `json:"failed"`
}

type ProjectAttemptMetrics struct {
	ProjectID          string              `json:"projectId"`
	ProjectTitle       string              `json:"projectTitle"`
	AttemptsBeforePass int                 `json:"attemptsBeforePass"`
	RunAttempts        int                 `json:"runAttempts"`
	SubmitAttempts     int                 `json:"submitAttempts"`
	Completed          bool                `json:"completed"`
	AvgExecutionTimeMs int64               `json:"avgExecutionTimeMs"`
	AvgTTFRMs          int64               `json:"avgTTFRMs"`
	FailedTests        []FailedTestMetrics `json:"failedTests"`
}

type FailedTestMetrics struct {
	TestName     string `json:"testName"`
	FailureCount int    `json:"failureCount"`
	LastError    string `json:"lastError"`
}

type PlatformAnalytics struct {
	DAU              int               `json:"dau"`
	WAU              int               `json:"wau"`
	MAU              int               `json:"mau"`
	DAUTrend         []TrendDataPoint  `json:"dauTrend"`
	WAUTrend         []TrendDataPoint  `json:"wauTrend"`
	ExecutionMetrics *ExecutionMetrics `json:"executionMetrics"`
	BrowserAnalytics *BrowserAnalytics `json:"browserAnalytics"`
}

type TrendDataPoint struct {
	Date      string `json:"date,omitempty"`
	WeekStart string `json:"weekStart,omitempty"`
	Count     int    `json:"count"`
}

// Execution Metrics Models

type ExecutionMetrics struct {
	AvgExecutionTimeMs    int64              `json:"avgExecutionTimeMs"`
	MedianExecutionTimeMs int64              `json:"medianExecutionTimeMs"`
	MinExecutionTimeMs    int64              `json:"minExecutionTimeMs"`
	MaxExecutionTimeMs    int64              `json:"maxExecutionTimeMs"`
	TotalExecutions       int                `json:"totalExecutions"`
	AvgTTFRMs             int64              `json:"avgTTFRMs"`
	ExecutionsByProject   []ProjectExecution `json:"executionsByProject"`
}

type ProjectExecution struct {
	ProjectID      string `json:"projectId"`
	ProjectTitle   string `json:"projectTitle"`
	AvgTimeMs      int64  `json:"avgTimeMs"`
	AvgTTFRMs      int64  `json:"avgTTFRMs"`
	ExecutionCount int    `json:"executionCount"`
}

// Browser/Device Analytics Models

type BrowserAnalytics struct {
	BrowserBreakdown []BrowserStat `json:"browserBreakdown"`
	OSBreakdown      []OSStat      `json:"osBreakdown"`
	DeviceBreakdown  []DeviceStat  `json:"deviceBreakdown"`
}

type BrowserStat struct {
	Browser    string  `json:"browser"`
	Count      int     `json:"count"`
	Percentage float64 `json:"percentage"`
}

type OSStat struct {
	OS         string  `json:"os"`
	Count      int     `json:"count"`
	Percentage float64 `json:"percentage"`
}

type DeviceStat struct {
	DeviceType string  `json:"deviceType"`
	Count      int     `json:"count"`
	Percentage float64 `json:"percentage"`
}

// Referral Application Models

type ReferralApplicationDocument struct {
	ID            primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	FullName      string             `json:"fullName" bson:"fullName"`
	Email         string             `json:"email" bson:"email"`
	TargetCompany string             `json:"targetCompany" bson:"targetCompany"`
	Role          string             `json:"role" bson:"role"`
	Profession    string             `json:"profession" bson:"profession"`
	School        string             `json:"school" bson:"school"`
	PhoneNumber   string             `json:"phoneNumber" bson:"phoneNumber"`
	Address       string             `json:"address" bson:"address"`

	// Links
	LinkedInURL string `json:"linkedInUrl" bson:"linkedInUrl"`
	JobURL      string `json:"jobUrl" bson:"jobUrl"`
	ResumeURL   string `json:"resumeUrl" bson:"resumeUrl"`

	// Additional context
	Motivation     string `json:"motivation" bson:"motivation"`
	AdditionalInfo string `json:"additionalInfo" bson:"additionalInfo"`

	// Metadata
	NotionPageID string `json:"notionPageId" bson:"notionPageId"`
	NotionURL    string `json:"notionUrl" bson:"notionUrl"`
	Source       string `json:"source" bson:"source"`

	// Matching
	UserID            *primitive.ObjectID `json:"userId,omitempty" bson:"userId,omitempty"`
	MatchedBy         string              `json:"matchedBy" bson:"matchedBy"`
	MatchConfidence   string              `json:"matchConfidence" bson:"matchConfidence"`
	NeedsManualReview bool                `json:"needsManualReview" bson:"needsManualReview"`
	ReviewReason      string              `json:"reviewReason,omitempty" bson:"reviewReason,omitempty"`

	// Status
	Status           string `json:"status" bson:"status"`
	AssignedReferrer string `json:"assignedReferrer,omitempty" bson:"assignedReferrer,omitempty"`

	// Timestamps
	SubmittedAt time.Time  `json:"submittedAt" bson:"submittedAt"`
	MatchedAt   *time.Time `json:"matchedAt,omitempty" bson:"matchedAt,omitempty"`
	UpdatedAt   time.Time  `json:"updatedAt" bson:"updatedAt"`
}
