# Premier Video Scheduling Reliability Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a secure Premier live-video appointment workflow where the member requests a time, an authorized coach confirms or counteroffers, both parties receive push notifications and reminders, conflicts are rejected, confirmed meetings appear on Google Calendar, and completed/no-show/cancelled sessions leave the active Admin queue for history.

**Architecture:** Keep `video_sessions` as the lifecycle record and add immutable time proposals, participants, and events. All state transitions are purpose-specific SECURITY DEFINER RPCs with actor validation, optimistic versioning, and conflict checks. The LiveKit token function accepts `sessionId`, resolves the private room server-side, and enforces assigned participant/status/join-window rules. Push notifications use `push_outbox` with deep-link metadata and dedupe keys. A server-side calendar integration creates/updates Google Calendar events using secrets unavailable to the client.

**Tech Stack:** Expo Router, React Native, TypeScript, Supabase/Postgres/RLS/RPCs/Edge Functions, Expo Notifications, LiveKit, Google Calendar API.

---

### Task 1: Scheduling schema and authoritative RPCs

**Files:**
- Create: `supabase/migrations/20260712100000_premier_video_scheduling_reliability.sql`

Add staff roles, video-session participant assignments, time proposals, lifecycle/event fields, one-active-session constraint, conflict detection, member request/counteroffer acceptance/reschedule/cancel RPCs, coach confirm/counteroffer/start/complete/no-show/cancel RPCs, active/history queries, and RLS/grants. Preserve existing rows and map `scheduled` to `confirmed` safely.

### Task 2: Restrict LiveKit room admission

**Files:**
- Modify: `supabase/functions/livekit-token/index.ts`
- Modify: `app/video-session.native.tsx`
- Modify: `app/video-session.web.tsx`
- Modify callers in `app/admin.tsx`, `app/(tabs)/support.tsx`, and `app/crisis-mode.tsx`

Accept `sessionId` for private video. Resolve room server-side. Permit assigned coach/admin for confirmed/live sessions and member only in the configured prejoin window/live. Deny requested, negotiating, terminal, archived, unassigned, and early access. Never authorize from client-supplied room names.

### Task 3: Member scheduling UX

**Files:**
- Modify: `src/hooks/usePrivateVideoSessions.ts`
- Create: `src/components/video/PremierSchedulingCard.tsx`
- Modify: `app/(tabs)/support.tsx`
- Modify: `app/crisis-mode.tsx`
- Modify locale files.

Require exact requested day/time, show timezone clearly, allow optional alternate time and meeting note, show coach counteroffer with accept/request-another actions, allow reschedule/cancel, render confirmed/local time, Add to Calendar, status-specific CTA, and terminal history/rebook.

### Task 4: Coach/Admin scheduling UX

**Files:**
- Create: `src/hooks/useAdminVideoSessions.ts`
- Create: `src/components/admin/VideoSessionManager.tsx`
- Modify: `app/admin.tsx`

Add Needs Action, Upcoming, Live, and History views. Confirm member request, propose alternative, assign coach, reschedule, start, complete, member-no-show, coach-no-show, and cancel. Hide archived sessions from default view. Display member and coach timezone and conflict errors.

### Task 5: Push notifications, reminders, and deep links

**Files:**
- Create migration for trigger/outbox changes and reminder cron.
- Modify: `src/hooks/usePushNotifications.ts`
- Modify: `supabase/functions/send-engagement-push/index.ts`

Notify assigned coach/admin on request and member responses. Notify member on confirmation/counteroffer/reschedule/cancel/live/completion. Enqueue 24-hour and one-hour reminders idempotently. Include `session_id`, route, event type, and dedupe key. Handle notification taps.

### Task 6: Google Calendar integration

**Files:**
- Create: `supabase/functions/sync-video-session-calendar/index.ts`
- Modify: `.github/workflows/supabase-functions.yml`
- Add migration/outbox trigger as needed.

Create/update/cancel a Google Calendar event for confirmed Premier sessions. Store event ID and sync state/error. Keep credentials server-side. Include member, coach, duration, and deep link; do not expose sensitive notes in calendar descriptions.

### Task 7: Tests and CI

**Files:**
- Create SQL authorization/state-machine tests.
- Create TypeScript tests for scheduling format/state helpers.
- Modify `package.json` and GitHub workflows.

Cover admission, invalid transitions, conflict detection, one-active-request race, timezone conversion, counteroffer acceptance, reschedule, no-show, archive filtering, notification idempotency, and calendar payload generation. Add typecheck/lint/test scripts and CI gates.

### Task 8: Verification and release gate

Run clean install, typecheck, tests, Expo Doctor, web export, Supabase migration reset/tests, Edge Function type checks, `git diff --check`, dependency audit, and final security/spec review. Commit verified changes. Do not deploy migrations/functions or publish EAS/OTA without Matt's final approval.
