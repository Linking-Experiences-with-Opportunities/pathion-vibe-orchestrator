# Funnel Telemetry Audit & Implementation Plan

**Date**: 2026-01-12  
**Status**: Backend code changes exist but NOT committed/deployed

---

## Executive Summary

The new pre-activation funnel requires telemetry events with `projectNumber` field to track user progression through warmup (Project 0) and curriculum (Project 1+). The **frontend is already deployed** and tracking `projectNumber` in telemetry, but the **backend queries exist locally but are NOT deployed**.

**Critical Issue**: Frontend crashes because backend returns old schema without new funnel fields.

---

## Current State

### ✅ What We Have (Already Implemented)

1. **Frontend Telemetry Tracking** (DEPLOYED):
   - `project_run_attempt` now includes `projectNumber` field
   - `project_submit_attempt` now includes `projectNumber` field
   - `user_activated` telemetry event fires on first real project submission

2. **Backend Code** (LOCAL ONLY - NOT COMMITTED):
   - `handlers/admin_analytics.go` - New `FunnelMetricsResponse` struct
   - `database/telemetry.go` - 6 new query functions for funnel metrics
   - All functions use `properties.projectNumber` to filter telemetry

3. **Database Collections**:
   - `runner_events` - Stores telemetry with flexible `properties` map
   - `browser_submissions` - Stores submissions (linked to projects via `problemId`)
   - `projects` - Has `projectNumber` field (0 for warmup, 1+ for curriculum)

---

## Data Flow Audit

### Stage 1: Signed In
- **Source**: `users` collection count
- **Status**: ✅ Works (no telemetry needed)

### Stage 2: Warmup Run (Project 0 run)
- **Source**: `runner_events` where `event="project_run_attempt"` AND `properties.projectNumber=0`
- **Frontend**: ✅ Emitting with `projectNumber`
- **Backend Query**: ✅ Implemented (`CountUsersWhoRanWarmup`)
- **Status**: 🟡 Ready to deploy

### Stage 3: Warmup Submit (Project 0 submit)
- **Source**: `browser_submissions` joined with `projects` where `projectNumber=0`
- **Frontend**: ✅ Submissions include `problemId`
- **Backend Query**: ✅ Implemented (`CountUsersWhoSubmittedWarmup`)
- **Status**: 🟡 Ready to deploy

### Stage 4: Entered Curriculum (Project 1+ run)
- **Source**: `runner_events` where `event="project_run_attempt"` AND `properties.projectNumber>=1`
- **Frontend**: ✅ Emitting with `projectNumber`
- **Backend Query**: ✅ Implemented (`CountUsersWhoEnteredCurriculum`)
- **Status**: 🟡 Ready to deploy

### Stage 5: Activated (Project 1+ submit)
- **Source**: `browser_submissions` joined with `projects` where `projectNumber>=1`
- **Frontend**: ✅ Submissions include `problemId` + `user_activated` telemetry
- **Backend Query**: ✅ Implemented (`CountDistinctActivatedUsers`)
- **Status**: 🟡 Ready to deploy

### Stage 6: Completed (Project 1+ passed)
- **Source**: `browser_submissions` where `passed=true` AND `projectNumber>=1`
- **Frontend**: ✅ Submissions include `passed` field
- **Backend Query**: ✅ Implemented (`CountDistinctCompletedRealProjects`)
- **Status**: 🟡 Ready to deploy

### Stage 7: Retained (Activated users who return)
- **Source**: Activated users with `>1` distinct submission day
- **Backend Query**: ✅ Implemented (`CountRetainedActivatedUsers`)
- **Status**: 🟡 Ready to deploy

---

## Critical Issues Found

### 🔴 Issue 1: Backend Not Deployed
- **Problem**: Frontend expects new schema, backend returns old schema
- **Impact**: Admin metrics page crashes with `TypeError: Cannot read properties of undefined`
- **Solution**: Deploy backend changes immediately

### 🟢 Issue 2: Telemetry Already Flowing
- **Status**: Frontend is ALREADY emitting `projectNumber` in telemetry
- **Impact**: Historical data (before today) won't have `projectNumber`
- **Solution**: Queries will naturally return 0 for old data, then grow as new data flows in

### 🟡 Issue 3: Identity Field Inconsistency
- **Problem**: Some queries use `userId`, others use `supabaseUserId`
- **Status**: Current implementation uses:
  - Telemetry queries: `userId` (Supabase UUID from JWT)
  - Submission queries: `supabaseUserId` (Supabase UUID)
- **Impact**: Should work correctly for authenticated users

---

## Implementation Plan

### ✅ Phase 1: Frontend (COMPLETE)
- [x] Add `projectNumber` to `project_run_attempt` telemetry
- [x] Add `projectNumber` to `project_submit_attempt` telemetry
- [x] Add `user_activated` telemetry event
- [x] Update `FunnelData` TypeScript interface
- [x] Update `FunnelChart` component
- [x] Add defensive null checks for undefined values

### 🔴 Phase 2: Backend (NEEDS DEPLOYMENT)
**Action Required**: Commit and deploy these changes

```bash
cd questions-api
git add database/telemetry.go handlers/admin_analytics.go
git commit -m "feat(analytics): Implement causally-ordered pre-activation funnel

- Add 7-stage funnel: SignedIn → WarmupRun → WarmupSubmit → 
  EnteredCurriculum → Activated → Completed → Retained
- Implement query functions using projectNumber from telemetry
- Fix ObjectID/string type mismatch in project lookups
- All stages are causally ordered (each is subset of previous)
"
git push
```

Then deploy to production (AWS App Runner or your deployment system).

### 📊 Phase 3: Verification (AFTER DEPLOYMENT)

1. **Check Backend Response**:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     https://your-api.com/admin/metrics/funnel
   ```
   
   Expected response:
   ```json
   {
     "signedIn": 18,
     "warmupRun": 15,
     "warmupSubmit": 12,
     "enteredCurriculum": 10,
     "activated": 8,
     "completed": 6,
     "retained": 4
   }
   ```

2. **Verify Causal Ordering**:
   ```
   signedIn >= warmupRun >= warmupSubmit >= 
   enteredCurriculum >= activated >= completed >= retained
   ```

3. **Check Individual Queries** (if any stage looks wrong):
   - Query `runner_events` for `project_run_attempt` with `properties.projectNumber`
   - Query `browser_submissions` joined with `projects`
   - Verify internal users are excluded

---

## Historical Data Considerations

### Before Today (2026-01-12)
- **Telemetry events**: Do NOT have `properties.projectNumber`
- **Impact**: Stages 2 & 4 (WarmupRun, EnteredCurriculum) will return 0
- **Mitigation**: Data will accumulate going forward

### After Today
- **Telemetry events**: DO have `properties.projectNumber`
- **Impact**: All funnel stages will work correctly

### Submissions (All Time)
- **Status**: Submissions always had `problemId`, can be joined with `projects`
- **Impact**: Stages 3, 5, 6, 7 will work with historical data

---

## Database Indexes Recommended

For optimal query performance, add these indexes:

```javascript
// MongoDB indexes for runner_events
db.runner_events.createIndex({ "event": 1, "properties.projectNumber": 1, "userId": 1 })
db.runner_events.createIndex({ "userId": 1, "createdAt": -1 })

// MongoDB indexes for browser_submissions
db.browser_submissions.createIndex({ "sourceType": 1, "problemId": 1, "supabaseUserId": 1 })
db.browser_submissions.createIndex({ "sourceType": 1, "passed": 1, "supabaseUserId": 1 })
db.browser_submissions.createIndex({ "supabaseUserId": 1, "createdAt": 1 })

// MongoDB indexes for projects
db.projects.createIndex({ "projectNumber": 1 })
```

---

## Files Changed

### Backend (questions-api/)
- `handlers/admin_analytics.go` - New FunnelMetricsResponse + GetFunnelMetrics handler
- `database/telemetry.go` - 6 new query functions + helper functions

### Frontend (mvp-web-app/) - ALREADY DEPLOYED
- `src/components/ProjectPageRevamped/projectActions.ts` - Added projectNumber to telemetry
- `src/components/Admin/metrics/FunnelChart.tsx` - New stages + tooltips
- `src/components/Admin/types.ts` - Updated FunnelData interface
- `src/hooks/useFunnelData.ts` - Updated fallback data

---

## Next Steps

1. **IMMEDIATELY**: Commit and deploy backend changes
2. **Monitor**: Watch for errors in production logs
3. **Verify**: Check that funnel chart loads without crashes
4. **Iterate**: Numbers may be low initially (only new telemetry has projectNumber)

---

## Contact

For questions about this implementation:
- Frontend telemetry: Check `src/components/ProjectPageRevamped/projectActions.ts`
- Backend queries: Check `questions-api/database/telemetry.go`
- Full RCA: See `mvp-web-app/docs/` for implementation notes
