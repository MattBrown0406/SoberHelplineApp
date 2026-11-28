# Monday meetings and the question queue

The Today card offers “Ask a question for Monday” before a seat is reserved. Support also offers the form. Questions are private to the submitting account and authorized admins. The optional “read without my name” preference is visible to hosts; it does not hide the account from the host. Crisis screening and immediate-help actions remain in place. Submissions time out after 15 seconds with their draft retained; retrying the same request does not create another question or alert.

Every new question queues one generic push per admin with a registered device. Tapping it opens Admin, where the question queue is near the top. Push acceptance does not guarantee device delivery, so the queue is the source of truth: it refreshes on focus and every 30 seconds while open, shows outstanding counts, and retains questions until an admin explicitly marks them answered. Answered questions can be viewed and reopened. Viewing alone never completes a question. Pending alerts for already-answered questions are suppressed. No question text or member name goes in a notification.

Admin → Monday attendance configures each Monday's actual topic and takeaway, an optional shared public welcome video, and the Zoom occurrence UUID. No video is required. The meeting card switches Join prominence with the meeting window. After a meeting, members with a return signal or reconciled attendance can save a private reflection and turn on a recurring seat; the old post-meeting membership/rating prompt is suppressed. Reflections are not included in host reports.

Attendance reports distinguish Join taps and unverified app returns from Zoom-confirmed attendance. Only exact email matches to verified app accounts count; names are never matched. Reconnects and overlapping devices count elapsed time once. Unmatched connections remain unknown. Reports are manually reconciled for a completed occurrence, with incomplete/failed imports preserving earlier results. A missing report means Unknown, not zero.

## Deployment

These changes are prepared on `codex/monday-attendance`; production migration/deployment is intentionally held under the repository README policy.

1. Apply the three `20261128` migrations through the approved deployment workflow. Deploy all checked-in Edge Functions, including `monday-reminders`, `monday-zoom-attendance`, and the updated legacy reminder senders, before enabling coordinated reminders or shipping the new submission UI.
2. Confirm the existing push dispatcher cron is running and each intended admin has granted notification permission and registered a device. The queue works without push permission. No email fallback is included.
3. For Zoom reconciliation, configure server-only `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, and `ZOOM_CLIENT_SECRET` for a Zoom Server-to-Server OAuth app authorized to read past meeting details and participants. Enter the actual completed occurrence UUID, save settings, then reconcile. Never use display names to resolve unidentified guests.
4. The new reminder flag starts OFF. Once functions are deployed, enable it in Admin. It suppresses the legacy Monday morning/one-hour/30-minute/15-minute sends and enables preview at 5 PM the day before the meeting in the member's zone, meeting-day 9 AM for reserved seats, and 15-minute Join reminders for reserved seats. Consent, declines, cancellations, locale, and bereavement quiet settings are checked before delivery. Members east of the Pacific may meet on Tuesday locally.
5. A claim is unique per account, meeting, and reminder phase. Ambiguous provider failures are not automatically retried, avoiding duplicate reminders; inspect `monday_reminder_sends` outcomes operationally. Existing question alerts use the retrying outbox dispatcher.
6. Upload the welcome video when ready and paste its HTTPS YouTube, Vimeo, or soberhelpline.com URL. Written first-time reassurance remains available meanwhile.

## Validation limits

Automated local tests use synthetic accounts and notifications. They do not send production pushes or import a live Zoom meeting. A physical-device notification/Zoom smoke test and configured Zoom credentials are required before release. Expo export checks JavaScript bundles; it is not an App Store/native signing build.

## Audit results

- Regression rounds fixed legacy delivery rules that blocked ordinary question alerts, missing notification navigation, duplicate submission retries, stale account/form responses, unfinished save states after focus changes, and stale Zoom/configuration handling.
- Database coverage verifies owner-only question/reflection access, admin-only answer tracking, one alert per question despite retries, delivery suppression after answering, exact verified-email attendance matching, import failure preservation, and reminder timing/declines.
- Final automated suites: 996 TypeScript tests, 402 JavaScript tests, 2,162 database assertions across 64 files, and 225 Deno shared-function tests passed. TypeScript and all Edge Function checks passed. Dependency release audit passed its existing accepted-advisory policy.
- Expo iOS, Android, and web exports succeeded with fixture environment values. These exported artifacts are for validation, not production distribution.
- Browser flow passed with fully intercepted network traffic: submission before RSVP, failed-send retry with the same ID, read-without-name preference, answer/reopen transitions, no page errors, and layouts at 320/390/768 px. Reproduce using `scripts/test-monday-meetings-browser.cjs` against a fixture export served with SPA fallback at port 4399; set `PLAYWRIGHT_MODULE` and optionally `BROWSER_CHANNEL` for your installed browser tooling.
