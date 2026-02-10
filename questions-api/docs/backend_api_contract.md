# Frontend ↔ Backend Integration Map

> **Repository Context**: This is a **backend-only** repository (`questions-api`).
> The frontend lives in a separate repository: [`mvp-web-app`](https://github.com/Linking-Experiences-with-Opportunities/mvp-web-app)
>
> This document maps the API endpoints provided by this backend to the frontend screens/components that are expected to consume them, based on the API documentation and handler implementations.

---

## Public Endpoints (No Authentication Required)

### Problems List Screen

Reads:
- `GET /problems` — Fetch list of all available coding problems

Backend Owners:
- `handlers/problems.go` (`GetProblems`)
- `database/questions.go`

Data Shapes:
- Response: `{ problems: ProblemListItem[], runnerContractVersion: string }`
- `ProblemListItem`: `{ id, questionNumber, title, difficulty, description }`

Notes:
- Returns all questions from the content database
- Used to render problem selection/browse UI

---

### Problem Detail Screen

Reads:
- `GET /problems/:id` — Fetch detailed problem info including test cases

Backend Owners:
- `handlers/problems.go` (`GetProblemByID`)
- `database/questions.go`

Data Shapes:
- Response: `{ problem: ProblemDetail, runnerContractVersion: string }`
- `ProblemDetail`: `{ id, questionNumber, title, difficulty, description, functionName, codeSnippet, tests, files, entry, limits }`
- `ProblemLimits`: `{ timeoutMs, memoryMB }`

Notes:
- `tests` contains test case inputs/expected outputs
- `limits` defines execution constraints for browser-based runner

---

### Projects List Screen

Reads:
- `GET /projects` — Fetch list of all available projects
- `GET /projects?category=<category>` — Filter by category (e.g., "data-structures")

Backend Owners:
- `handlers/projects.go` (`GetProjects`)
- `database/projects.go`

Data Shapes:
- Response: `{ projects: ProjectListItem[], runnerContractVersion: string }`
- `ProjectListItem`: `{ id, projectNumber, title, difficulty, description, category, tags, totalTests, passedTests, isCompleted }`

Notes:
- If user is authenticated (JWT), returns progress data (`totalTests`, `passedTests`, `isCompleted`)
- Progress is fetched from `browser_submissions` collection
- Supports category filtering via query param

---

### Project Detail Screen

Reads:
- `GET /projects/:id` — Fetch detailed project info including starter files and test file

Backend Owners:
- `handlers/projects.go` (`GetProjectByID`)
- `database/projects.go`

Data Shapes:
- Response: `{ project: ProjectDetail, runnerContractVersion: string }`
- `ProjectDetail`: `{ id, projectNumber, title, difficulty, description, instructions, starterFiles, testFile, category, tags, limits }`
- `ProjectTestFile`: `{ filename, content }`
- `ProjectLimits`: `{ timeoutMs: 10000, memoryMB: 256 }`

Notes:
- `starterFiles` is a map of filename → content
- `instructions` contains full markdown instructions
- Frontend initializes code editor with starter files

---

### Question Detail Screen (Legacy)

Reads:
- `GET /question/:number` — Fetch question by number with test cases

Backend Owners:
- `handlers/questions.go` (`GetQuestion`)
- `database/questions.go`

Data Shapes:
- Response: `QuestionDocument` with embedded `testcases`
- `QuestionDocument`: `{ questionNumber, description, codeSnippet, driver, difficulty, title, methodName, testcases }`

Notes:
- Legacy endpoint, appears to be superseded by `/problems/:id`
- Test names are dynamically generated ("Test case 1", "Test case 2", etc.)

---

### Modules List Screen

Reads:
- `GET /modules` — Fetch list of all learning modules

Backend Owners:
- `handlers/modules.go` (`GetAllModules`)
- `database/modules.go`

Data Shapes:
- Response: `ModuleDocument[]`
- `ModuleDocument`: `{ _id, title, description, content, createdAt, updatedAt }`

Notes:
- Modules contain mixed content (text, question, video, project)

---

### Module Detail Screen

Reads:
- `GET /modules/:id` — Fetch single module with all content items

Backend Owners:
- `handlers/modules.go` (`GetModule`)
- `database/modules.go`

Data Shapes:
- Response: `ModuleDocument` with `content: ModuleContentItem[]`
- `ModuleContentItem`: `{ id, type: "text" | "question" | "video" | "project", data }`

Content Type Data Shapes:
- `type: "text"` → `data: { title?, content?, description?, estimatedMinutes? }`
- `type: "question"` → `data: QuestionDocument` (embedded, with testcases)
- `type: "video"` → `data: { title?, videoUrl?, description?, duration? }`
- `type: "project"` → `data: { projectId, title? }`

Notes:
- Content items with `type: "question"` have embedded `QuestionDocument` in `data`
- Test names are injected dynamically
- `video` and `project` types are stored but have no special server-side processing
- Data shapes are not validated by backend — frontend is responsible for handling missing fields gracefully
- Frontend may display "question" type as "Problem" or "Practice" — these are UI labels, not distinct backend types

---

### Beta Whitelist Check

Reads:
- `GET /verify?email=<email>` — Check if email is in beta whitelist

Backend Owners:
- `handlers/whitelist.go` (`CheckWhitelist`)
- `database/whitelist.go`

Data Shapes:
- Response: `{ inCohort: boolean }`

Notes:
- Queries Supabase `beta_whitelist` table
- Used for gating access during beta period

---

### Health Checks

Reads:
- `GET /health` — Simple health check
- `GET /health/db` — Health check with database status
- `GET /version` — Get deployed version info

Backend Owners:
- `routes/routes.go` (inline handlers)
- `handlers/diagnostics.go` (`GetHealthWithDB`)

Data Shapes:
- `/health`: `{ status: "ok :D" }`
- `/health/db`: `{ status: "healthy" | "unhealthy", database: { appDb, nodeEnv } }`
- `/version`: `{ version: string, deployedAt: string }`

Notes:
- Used for monitoring and deployment verification

---

## Protected Endpoints (JWT Authentication Required)

### Code Submission (Browser Runner)

Writes:
- `POST /submissions` — Submit browser execution results
- `POST /api/submissions` — Alias for backwards compatibility

Backend Owners:
- `handlers/browser_submissions.go` (`CreateBrowserSubmission`)
- `database/browser_submissions.go`

Data Shapes:
- Request: `BrowserSubmissionPayload`
  - `{ problemId, userId, email, language, sourceType, files, userTestsCode, userTestsResults, result, meta }`
- `BrowserExecutionResult`: `{ exitCode, stdout, stderr, testSummary, durationMs }`
- `BrowserTestSummary`: `{ total, passed, failed, cases: BrowserTestCaseResult[] }`
- `BrowserExecutionMeta`: `{ pyodideVersion, timedOut, memExceeded, sandboxBootMs, fallbackUsed, fallbackReason, editorSignals, vizPayload }`
- Response: `{ submissionId, passed, runnerContractVersion }`

Notes:
- JWT claims provide authoritative `userId` and `email` (strict mode)
- `sourceType`: "code" for problems, "project" for projects
- Stores in `browser_submissions` collection
- `editorSignals` tracks clipboard activity for investigation (no raw text stored)
- `vizPayload` (optional) contains structured data for the Mermaid Debug View (graph/linked-list structure + markers)

---

### Question Submission (Legacy)

Writes:
- `POST /question/:number/submissions` — Submit question answer (delegates to browser submission)

Backend Owners:
- `handlers/browser_submissions.go` (`CreateQuestionSubmission`)

Notes:
- Wrapper that delegates to `CreateBrowserSubmission`

---

### Telemetry Events

Writes:
- `POST /telemetry` — Send telemetry events from frontend runner
- `POST /api/telemetry` — Alias for backwards compatibility

Backend Owners:
- `handlers/telemetry.go` (`CreateTelemetryEvent`)
- `database/telemetry.go`

Data Shapes:
- Request: `TelemetryEvent`
  - `{ event, properties, timestamp, userId, sessionId }`
- Response: `{ status: "ok" }`

Notes:
- Key events: `runner_result`, `project_run_attempt`, `project_submit_attempt`, `project_submission_result`
- Always returns success (telemetry failure shouldn't break UX)
- Stores in `runner_events` collection

---

### Project Submissions History

Reads:
- `GET /projects/:id/submissions` — Get user's submissions for a specific project

Backend Owners:
- `handlers/projects.go` (`GetProjectSubmissions`)
- `database/browser_submissions.go`

Data Shapes:
- Response: `{ submissions: BrowserSubmissionDocument[], runnerContractVersion }`

Notes:
- Filtered by authenticated user's `userId` from JWT
- Returns submission history for progress tracking

---

### User Tests (Custom Test Cases)

Reads:
- `GET /projects/:projectId/user-tests` — Get user's custom tests for a project
- `GET /user-tests` — Get all user tests across all projects

Writes:
- `PUT /projects/:projectId/user-tests` — Save user's custom tests
- `DELETE /projects/:projectId/user-tests` — Delete user's custom tests

Backend Owners:
- `handlers/user_tests.go` (`GetUserTests`, `SaveUserTests`, `DeleteUserTests`, `GetAllUserTests`)
- `database/user_tests.go`

Data Shapes:
- Request (PUT): `{ tests: UserTestDocument[] }`
- Response: `{ success: boolean, tests?: UserTestDocument[] }`
- `UserTestDocument`: `{ name, code, expected }`

Notes:
- Uses normalized email as `userId` for consistent querying
- Allows users to create custom test cases for projects

---

### Decision Trace Replay (V1)

Writes:
- `POST /decision-trace/event` — Record a Run/Submit event with code snapshot, execution results, optional visualization and AI artifacts

Reads:
- `GET /decision-trace/session?contentId=<id>&contentType=<type>` — Get active session for authenticated user + content item
- `GET /decision-trace/timeline?sessionId=<id>` — List minimal event headers for timeline scrubber
- `GET /decision-trace/event?id=<id>` — Load full event document for scrub/detail view

Backend Owners:
- `handlers/decision_trace.go` (`CreateDecisionTraceEvent`, `GetDecisionTraceSession`, `GetDecisionTraceTimeline`, `GetDecisionTraceEvent`)
- `database/decision_trace.go`

Data Shapes:
- Request (POST): `DTEventPayload`
  - `{ contentId, contentType, language, eventType, codeText, browserSubmissionId?, execution?, visualization?, ai? }`
- `contentType`: `"project"` | `"problem"` | `"module_problem"`
- `eventType`: `"RUN"` | `"SUBMIT"`
- `execution`: `{ universalErrorCode?, errorLog?, stdout?, runtimeMs?, memoryKb?, tests: { total?, passed?, failed? }, testResults?: [{ testName, status, message?, errorCode?, errorTooltip? }] }`
- `visualization`: `{ kind?: "MERMAID", mermaidText?, stateSnapshot?: object }`
- `ai`: `{ nano: { enabled, promptVersion?, summary? }, gemini: { enabled, model?, promptVersion?, nudgeType?, responseText?, citedLineRanges?: [{ file?, startLine, endLine }] } }`
- Response (POST): `{ eventId: string, sessionId: string }` (or `{ eventId, sessionId, duplicate: true }` if idempotent match)
- Response (GET session): `{ session: DecisionTraceSessionDocument | null }`
- `DecisionTraceSessionDocument`: `{ _id, userId, contentId, contentType, language, status, startedAt, endedAt?, schemaVersion, lastEventAt, lastEventId?, totalEvents, lastBrowserSubmissionId? }`
- Response (GET timeline): `{ sessionId: string, events: DecisionTraceTimelineEntry[] }`
- `DecisionTraceTimelineEntry`: `{ eventId, createdAt, eventType, testsFailed?, universalErrorCode? }`
- Response (GET event): `{ event: DecisionTraceEventDocument }`
- `DecisionTraceEventDocument`: `{ _id, schemaVersion, sessionId, userId, contentId, contentType, language, eventType, createdAt, browserSubmissionId?, code, execution, visualization, ai }`
- `code`: `{ text, sha256 }`

Notes:
- JWT claims provide authoritative `userId` (strict mode, same as `/submissions`)
- `contentId` generalizes `projectId` to support projects, problems, and module coding problems
- Sessions are auto-created on first event for a (user, content, language) tuple
- Session transitions to `"ended"` when a `SUBMIT` event has all tests passing (`tests.failed == 0 && tests.total > 0`)
- Idempotency: if `browserSubmissionId` is provided and already exists, returns existing event (no duplicate)
- `testResults` capped to 10 entries per event (V1)
- `stateSnapshot` (optional) contains extracted data structure invariants (e.g., linked-list head/tail/size, arraylist size/capacity, circular-queue indices). Backend stores as opaque JSON; frontend defines the shape per data structure type.
- Admin users (`@linkedinorleftout.com` or `role == "admin"`) can view any user's sessions/events via optional `userId` query param on GET session, or directly on timeline/event endpoints
- Regular users can only access their own sessions and events
- Stores in `decision_trace_sessions` and `decision_trace_events` collections (app DB)
- `browserSubmissionId` references `browser_submissions._id` (hex string) for cross-referencing

---

### Module Test Case Execution (Legacy)

Writes:
- `POST /modules/:id/testcases/run` — Run test cases for module question (rate limited: 3/min)
- `POST /modules/:id/submission` — Submit module question answer (rate limited: 1/min)

Backend Owners:
- `handlers/modules.go` (`RunModuleTestCases`, `CreateModuleQuestionSubmission`)
- `handlers/coderunner.go`

Data Shapes:
- Request: `RunModuleTestCasePayload` - `{ testCaseNumber, runAllCases, languageID, sourceCode, contentIndex }`
- Response: `TestResult[]` - `{ name, expected, actual, passed, printed, errorMessage }`

Notes:
- Uses Judge0 for code execution (legacy)
- Rate limited to prevent abuse

---

### Question Test Case Execution (Legacy)

Writes:
- `POST /question/:number/testcases/run` — Run test cases for question

Backend Owners:
- `handlers/coderunner.go` (`WrapRunTestCases`)

Notes:
- Legacy endpoint using Judge0
- Being superseded by browser-based execution

---

### Module Activity Progress Tracking

Reads:
- `GET /modules/progress` — Get progress for all modules for authenticated user
- `GET /modules/:id/progress` — Get progress for specific module

Writes:
- `POST /modules/:id/progress` — Mark activity as complete

Backend Owners:
- `handlers/activity_progress.go` (`GetAllActivityProgress`, `GetActivityProgress`, `CreateActivityProgress`)
- `database/activity_progress.go`

Data Shapes:
- `GET /modules/progress` Response: `{ progress: { [moduleId: string]: string[] } }`
- `GET /modules/:id/progress` Response: `{ completedActivityIds: string[] }`
- `POST /modules/:id/progress` Request: `{ activityId: string }`
- `POST /modules/:id/progress` Response: `{ success: boolean, completedAt: string }`

Notes:
- JWT required for all progress endpoints
- `activityId` is the string index ("0", "1", etc.) corresponding to content array position
- Upsert operation — calling POST multiple times is idempotent

---

## Admin Endpoints (JWT + Admin Role Required)

### Admin Dashboard - Overall Metrics

Reads:
- `GET /admin/metrics` — Platform-wide metrics (DAU, WAU, MAU, trends)
- `GET /admin/metrics?include_internal=true` — Include internal users

Backend Owners:
- `handlers/metrics.go` (`GetOverallMetricsForAdmin`)
- `handlers/admin_analytics.go` (`calculatePlatformAnalytics`)

Data Shapes:
- Response: `{ overallMetrics: OverallMetrics, userMetrics: UserMetrics }`
- `OverallMetrics`: `{ stats, questions_by_difficulty, platformAnalytics }`
- `PlatformAnalytics`: `{ dau, wau, mau, dauTrend, wauTrend, executionMetrics, browserAnalytics }`

Notes:
- DAU/WAU/MAU calculated from telemetry events
- `include_internal=true` to include @linkedinorleftout.com users

---

### Admin Dashboard - Onboarding Funnel

Reads:
- `GET /admin/metrics/funnel` — Pre-activation funnel metrics (causally ordered stages)

Backend Owners:
- `handlers/admin_analytics.go` (`GetFunnelMetrics`)
- `database/telemetry.go`, `database/browser_submissions.go`

Data Shapes:
- Response: `FunnelMetricsResponse`
  - `{ totalUsers, signedIn, warmupRun, warmupSubmit, enteredCurriculum, activated, completed, retained }`

Notes:
- Stage 0: Total Supabase users
- Stage 1: Users in MongoDB
- Stage 2-3: Warmup project activity
- Stage 4-7: Curriculum engagement metrics

---

### Admin Dashboard - User Roster

Reads:
- `GET /admin/roster?page=<n>&limit=<n>` — Paginated user list from Supabase

Backend Owners:
- `handlers/admin_roster.go` (`GetRoster`)
- `internal/clients/supabase/admin.go`

Data Shapes:
- Response: `{ users, page, limit, projectsTotal, projectsCompletedByUser, passRatesByUser }`

Notes:
- Users fetched from Supabase, enriched with MongoDB completion data
- Max 100 users per page

---

### Admin Dashboard - User Detail

Reads:
- `GET /admin/users/:email/metrics` — Detailed metrics for specific user
- `GET /admin/users/:email/projects/:projectId/submissions` — User's submissions for specific project

Backend Owners:
- `handlers/admin_analytics.go` (`GetUserDetailedMetrics`, `GetUserProjectSubmissions`)

Data Shapes:
- Response: `UserDetailedMetrics`
  - `{ email, name, role, projectStats, recentSubmissions, projectAttempts, lastSeenBrowser, lastSeenOS, lastSeenDevice }`
- `ProjectAttemptMetrics`: `{ projectId, projectTitle, attemptsBeforePass, runAttempts, submitAttempts, completed, failedTests }`

Notes:
- Accepts email or Supabase UUID as identifier
- `failedTests` aggregates most common test failures

---

### Admin Dashboard - User Search

Reads:
- `GET /admin/users/search?query=<prefix>` — Search users by email prefix

Backend Owners:
- `handlers/users.go` (`GetUserSuggestions`)

Data Shapes:
- Response: `UserSuggestion[]` - `{ name, email, role }`

Notes:
- Returns max 4 suggestions
- Role determined by email domain

---

### Admin Dashboard - Latest Submissions Feed

Reads:
- `GET /admin/submissions/latest?limit=<n>&timeRange=<range>` — Recent submission activity

Backend Owners:
- `handlers/admin_analytics.go` (`GetLatestSubmissions`)

Data Shapes:
- Response: `{ submissions: LatestSubmissionResponse[] }`
- `LatestSubmissionResponse`: `{ _id, userId, email, image, projectTitle, problemId, passed, testSummary, durationMs, os, createdAt }`

Notes:
- `timeRange` options: 1h, 12h, 24h, 7d, 30d, all
- Max 100 submissions per request
- `include_internal=true` to include internal users

---

### Admin Dashboard - Individual User Metrics

Reads:
- `GET /admin/metrics/user?email=<email>` — Module-based metrics for user

Backend Owners:
- `handlers/metrics.go` (`GetMetricsForUser`)

Data Shapes:
- Response: `{ email, solved_questions, unsolved_questions, module length, submissions length }`

Notes:
- Legacy endpoint for module-based progress tracking

---

### Admin - Project Management

Reads:
- `GET /admin/projects` — List all projects (same as public)
- `GET /admin/projects/:id` — Get project details (same as public)

Writes:
- `POST /admin/projects` — Create new project
- `PUT /admin/projects/:id` — Update existing project
- `DELETE /admin/projects/:id` — Delete project

Backend Owners:
- `handlers/projects.go` (`CreateProject`, `UpdateProject`, `DeleteProject`)
- `database/projects.go`

Data Shapes:
- Request (POST/PUT): `ProjectPayload`
  - `{ title, description, difficulty, instructions, starterFiles, testFile, category, tags }`
- Response: `{ success: boolean, id?: string }`

---

### Admin - Question Management

Writes:
- `POST /admin/question` — Create new question

Reads:
- `GET /admin/questions` — List all questions

Backend Owners:
- `handlers/questions.go` (`CreateQuestion`, `GetAllQuestions`)

Data Shapes:
- Request (POST): `QuestionPayload`
  - `{ description, code_snippet, testcases, difficulty, title, driver, methodName, className }`

---

### Admin - Module Management

Writes:
- `POST /admin/module` — Create new module
- `PUT /admin/module/:id` — Update module
- `DELETE /admin/module/:id` — Delete module

Backend Owners:
- `handlers/modules.go` (`CreateModule`, `UpdateModule`, `DeleteModule`)

Data Shapes:
- Request (POST): `ModulePayload` - `{ title, description, content }`
- Request (PUT): `UpdateModulePayload` - `{ title?, description?, content? }`

---

### Admin - Whitelist Management

Writes:
- `POST /admin/whitelist` — Add email to beta whitelist
- `DELETE /admin/whitelist?email=<email>` — Remove email from whitelist

Backend Owners:
- `handlers/whitelist.go` (`AddToWhitelist`, `RemoveFromWhitelist`)

Data Shapes:
- Request (POST): `{ email: string }`
- Response: `{ success: boolean, email: string }`

---

### Admin - Referral Applications

Reads:
- `GET /admin/referrals` — List pending referral applications
- `GET /admin/referrals/review` — Get applications needing manual review

Backend Owners:
- `handlers/referrals.go` (`GetReferralApplications`, `GetReferralApplicationsNeedingReview`)

Data Shapes:
- Response: `ReferralApplicationDocument[]`

---

### Admin - Database Indexes

Writes:
- `POST /admin/indexes/create` — Create MongoDB indexes for analytics performance

Backend Owners:
- `handlers/admin_analytics.go` (`CreateAnalyticsIndexes`)

Notes:
- Creates indexes on `runner_events` and `browser_submissions` collections

---

### Admin - Diagnostics

Reads:
- `GET /admin/diagnostics` — Database connection and configuration info

Backend Owners:
- `handlers/diagnostics.go` (`GetDiagnostics`)

Data Shapes:
- Response: `{ database, timestamp, health }`

---

### Admin - Test Case Execution

Writes:
- `POST /admin/question/run` — Run test cases (admin version, no rate limit)

Backend Owners:
- `handlers/coderunner.go` (`WrapRunTestCasesForAdmin`)

---

## Webhook Endpoints (Secret Header Required)

### Airtable Whitelist Webhook

Writes:
- `POST /webhooks/whitelist` — Add email to whitelist (from Airtable automation)

Backend Owners:
- `handlers/whitelist.go` (`AddToWhitelist`)

Notes:
- Protected by `X-Webhook-Secret` header
- Same handler as admin endpoint

---

### Supabase User Sync Webhook

Writes:
- `POST /webhooks/user-sync` — Sync user from Supabase (DEPRECATED)

Backend Owners:
- `handlers/user_sync.go` (`SyncUserFromSupabase`)

Notes:
- Returns 200 OK but does nothing (deprecated in Phase 2 migration)

---

### Referral Application Webhook

Writes:
- `POST /webhooks/referral` — Create referral application from external form

Backend Owners:
- `handlers/referrals.go` (`CreateReferralApplication`)

Data Shapes:
- Request: `ReferralApplicationPayload`
  - `{ fullName, email, targetCompany, role, profession, school, phoneNumber, address, linkedInUrl, jobUrl, resumeUrl, motivation, additionalInfo, notionPageId, notionUrl }`
- Response: `{ id, message, matched: boolean }`

Notes:
- Protected by `X-Webhook-Secret` header
- Auto-matches to existing users by email

---

## Data Stores

### MongoDB Collections

| Collection | Purpose | Owner |
|------------|---------|-------|
| `questions` | Coding problems (content DB) | `database/questions.go` |
| `projects` | Multi-file projects (content DB) | `database/projects.go` |
| `modules` | Learning modules with mixed content (content DB) | `database/modules.go` |
| `browser_submissions` | User submission results (app DB) | `database/browser_submissions.go` |
| `runner_events` | Telemetry events (app DB) | `database/telemetry.go` |
| `users` | User profiles (app DB, legacy) | `database/users.go` |
| `user_tests` | Custom user test cases (app DB) | `database/user_tests.go` |
| `module_submissions` | Module question submissions (app DB, legacy) | `database/module_submissions.go` |
| `activity_progress` | Module activity completion tracking (app DB) | `database/activity_progress.go` |
| `referral_applications` | Referral program applications (app DB) | `database/referrals.go` |
| `decision_trace_sessions` | Decision trace session grouping (app DB) | `database/decision_trace.go` |
| `decision_trace_events` | Decision trace Run/Submit event snapshots (app DB) | `database/decision_trace.go` |

### External Services

| Service | Purpose |
|---------|---------|
| Supabase Auth | User authentication, JWT tokens, user roster |
| Supabase Database | Beta whitelist table |
| Judge0 | Legacy code execution (being phased out) |

---

## Key Invariants

1. **JWT as Source of Truth**: All protected endpoints use JWT claims for `userId` and `email` - payload values are ignored.

2. **Email Normalization**: Emails are normalized (lowercase, trimmed) before storage/querying for consistent matching.

3. **Content vs App Database**: Content (questions, projects, modules) is separate from runtime data (submissions, telemetry).

4. **Internal User Exclusion**: Metrics endpoints exclude `@linkedinorleftout.com` users by default.

5. **Browser-Based Execution**: Code execution happens in the browser (Pyodide). Backend stores results only.

6. **Runner Contract Version**: All problem/project endpoints return `runnerContractVersion` for frontend compatibility checks.

---

## Uncertainties

1. **Frontend Route Names**: Exact frontend screen/component names are uncertain since frontend is in a separate repository.

2. **Legacy Endpoint Usage**: Unclear which legacy endpoints (`/question/*`, `/modules/*/submission`) are still actively used.

3. **User Tests Feature**: The custom user tests feature implementation status in the frontend is uncertain.

4. **EditorSignals Consumption**: How/if the frontend uses the EditorSignals data for investigation is uncertain.

---

*Generated from backend codebase analysis. Frontend repository: `mvp-web-app`*
