# Contextual membership invitation contract

One quiet system for inviting a free member to look at the plans: a small inline card at a success moment, rarely, and never beside another ask.

Import `ContextualMembershipInvitation` from `./ContextualMembershipInvitation`.

```tsx
<ContextualMembershipInvitation
  accountId={completedActivityAccountId}
  completed={activitySuccessfullyCompleted}
  placement="practice-completed" // or one of the placements below
/>
```

## Placements

| Placement | Where | Source label | Its own line (plans.json `invite.*`) |
| --- | --- | --- | --- |
| `practice-completed` | `app/free-practice.tsx`, after the free practice is done | `practice_completed` | `title` + `practiceCompleted` |
| `boundary-saved` | `src/components/boundaries/BoundaryFollowThroughCard.tsx`, after a boundary save succeeds | `boundary_saved` | `title` + `boundarySaved` |
| `after-meeting` | Today, back from Family Squares (`src/lib/afterMeetingInvite.ts`) | `after_meeting` | `afterMeetingTitle` + `afterMeeting` |
| `tool-finished` | `app/holiday-plan.tsx`, `app/letter.tsx`, `app/prosecutor-letter.tsx`, at the moment each logs `logToolUsage(..., 'finished')` | `tool_finished` | `title` + `toolFinished` |
| `checkin-week` | Today (free Today only), under the check-in, when her check-in streak reaches 5 days (never the 7th: that is the rating prompt's day) | `checkin_week` | `checkinWeekTitle` + `checkinWeek` |

Every card then adds `invite.body`, and one more line, `invite.trial`, only when the App Store says Essential starts with a free trial for her (`usePlanOffers().trialLabel('essential')`, the same answer the plans screen shows). When the store's answer is unknown or there is no trial, nothing is said about a trial. Each line names only a benefit that is in `ESSENTIAL_BENEFITS` (`src/lib/membershipBenefits.ts`) and plans.json `benefits.essential`; no line names a price or the website.

## Mounting

Mount with `completed=false` BEFORE the activity. Set true only after explicit completion of the useful neutral free activity, after its save/finish actually succeeded (the letter waits, in addition, for the rating-prompt check that follows its finish). Capture `accountId` from `useAccount().user.id` BEFORE starting the asynchronous save; discard stale saves after account changes. Keep props stable after success; reset false only for a new activity (or, on Today, when the moment is over: leaving Today for `checkin-week`, leaving the app for `after-meeting`). Mounting with true, hydration, focus, account readiness transitions and account changes do not trigger a claim. Do not conditionally mount only after success. Parent must reset completion on logout/account switch and exclude crisis/safety placements entirely.

Privacy: do not derive eligibility from what she wrote, her mood, severity, sentiment, private responses, boundary wording or distress (the check-in moment is the streak count only, never her answers). Never pass any response/boundary text. Analytics are two membership-path events, `membership_invite_shown` when the card appears and `membership_invite_tapped` on "See plans"; each carries only the placement's source label, never anything about the activity. The server keeps the label only if it is on its list (`_membership_path_sources()`, last redefined in migration `20261124110000_membership_invite_placements`; `PLAN_SOURCES` in `src/lib/membershipPath.ts` mirrors it).

## Who

The component independently uses `useAccount`: authenticated, loaded, no account error, no offline fallback, direct-free, not attached, not admin, and exact matching account ID. Inline only: no modal, notification or push. All words are in `src/locales/<lang>/plans.json` under `invite`. Every button has minimum 44px width/height and native/web button semantics.

CTA route is the plans screen (`plansHref(source)` → `/plans?source=<placement label>`).

## How often (`policy.ts`)

A claim is refused unless every one of these holds:

| Limit | Value |
| --- | --- |
| Gap between invitations, across all placements | 7 days (`MIN_GAP`) |
| Invitations in any rolling 30 days | at most 3 (`MAX_IN_WINDOW`, `WINDOW`) |
| Her first days | none until the account is 3 days old (`NEW_ACCOUNT_QUIET`, from `user.joinedAt`; unknown counts as new) |
| "Not now" | snoozes 7 days the first time, 14 the second, 30 every time after (`NOT_NOW_SNOOZES`) |
| "Don’t show again" | permanent |
| Shown 3 times in a row with no tap and no dismissal | 30-day pause after the third (`UNANSWERED_LIMIT`, `UNANSWERED_PAUSE`); the count starts again after the pause or at any tap/dismissal |
| `after-meeting` | at most once every 14 days, on top of the above (`AFTER_MEETING_GAP`) |
| One ask per visit | none on a visit (until the app next leaves the foreground) when the App Store rating prompt was requested, may have been (a failed check), or is still being checked, or when the reminder ask was shown (`visitAsks.ts`) |
| One card at a time | while one card is visible for an account, no other placement can claim |

One ask per visit is decided in one place, `visitAsks.ts`: `src/lib/reviewPrompt.ts` reports every rating-prompt check (running, and requested/failed) for every milestone; `src/lib/afterMeetingInvite.ts` reports the after-meeting check; Today reports its reminder ask. `clearMeetingReturn()` (called by the app layout when the app leaves the foreground or the account changes) ends the visit. The reminder ask under a saved seat (`useSeatReminderAsk`) does not report yet (see the 4.4 notes).

## Storage

Persistence uses account-ID-namespaced AsyncStorage, version 2 (`membership-invitation:v2:<id>`). A version-2 record holds only: opted out, snoozed-until, how many "Not now"s, the times shown in the last 30 days, the last after-meeting time and how many were left unanswered in a row. When there is no version-2 record, the 4.3 version-1 record (`membership-invitation:v1:<id>`) is read and converted (its last showing, after-meeting time and opt-out still count; a snooze it holds counts as one "Not now"); it is never written, and the first write creates the version-2 record. Unknown versions and damaged records fail closed.

No mount hydration writes. A claim reads and validates the record, then persists the showing before displaying. Reservations are intentionally retained if unmounted during the write. A tap on "See plans" and either dismissal are answers: they reset the unanswered count (and dismissals set the snooze or opt-out). Storage/corruption errors suppress prompts (also latched for that account for this runtime); failed preference writes cannot promise cross-restart durability. No error toast interrupts the completed activity.

One module singleton serializes all placement claims/read-modify-writes in an app runtime and tracks a visible owner. Scope/cancellation checks fence delayed reads and renders. Preferences are on-device, account-scoped, not server-synced: separate devices or simultaneous browser tabs do not have transactional shared claims. Clearing app/browser data clears these local preferences. A server-backed transactional policy would be needed for cross-device guarantees.

## Measuring

Admin (`app/admin.tsx`, `src/components/admin/InvitationPlacementsCard.tsx`) shows, per place, the members shown an invitation, who tapped it, and who subscribed with that place as their source, over the last 30 days.

## Tests

`npx tsx --test tests/membership-invitations.test.ts` executes the actual policy and `visitAsks`, not native rendering. The UI test (`node --test tests/membership-invitation-ui.test.mjs`) runs the real component with stand-in hooks. `tests/membership-plans.test.ts` pins the placements, the source lists (app and server), the words and the admin figures. Parent must verify integrated false-to-true events, route, logout rendering, language and screen-reader/device layout.
