# Contextual membership invitation contract

Import `ContextualMembershipInvitation` from `./ContextualMembershipInvitation`.

```tsx
<ContextualMembershipInvitation
  accountId={completedActivityAccountId}
  completed={activitySuccessfullyCompleted}
  placement="practice-completed" // or "boundary-saved"
/>
```

Mount with `completed=false` BEFORE the activity. Set true only after explicit completion of the useful neutral free practice or after a boundary save actually succeeds. Capture `accountId` from `useAccount().user.id` BEFORE starting the asynchronous save; discard stale saves after account changes. Keep props stable after success; reset false only for a new activity. Mounting with true, hydration, focus, account readiness transitions and account changes do not trigger a claim. Do not conditionally mount only after success. Parent must reset completion on logout/account switch and exclude crisis/safety/check-in placements entirely. Do not derive eligibility from severity, sentiment, private responses, boundary wording or distress. Never pass any response/boundary text. There are no analytics calls or payloads.

The component independently uses `useAccount`: authenticated, loaded, no account error, no offline fallback, direct-free, not attached, not admin, exact matching account ID. Inline only: no modal, notification or push. English/Spanish selected via i18n language. Every button has minimum 44px width/height and native/web button semantics.

CTA route is `/membership-guide`; parent owns creating this route and regenerating Expo typed routes. Do not cast away the expected missing-route TypeScript error before integration.

Persistence uses account-ID-namespaced AsyncStorage, version 1. Records contain only optout and timestamps. No mount hydration writes. Claim reads and validates scoped preferences, then persists a rolling 24-hour show reservation before displaying; this is stricter than a calendar-day limit. Reservations are intentionally retained if unmounted during the write. `Not now` adds seven days; `Don’t show again` permanently opts out. Storage/corruption errors suppress prompts (also latched for that account for this runtime); failed preference writes cannot promise cross-restart durability. No error toast interrupts the completed activity.

One module singleton serializes all placement claims/read-modify-writes in an app runtime and tracks a visible owner. Scope/cancellation checks fence delayed reads and renders. Preferences are on-device, account-scoped, not server-synced: separate devices or simultaneous browser tabs do not have transactional shared claims. Clearing app/browser data clears these local preferences. A server-backed transactional policy would be needed for cross-device guarantees.

Tests: `npx tsx --test tests/membership-invitations.test.ts`. These execute the actual policy, not native rendering. Parent must verify integrated false-to-true events, route, logout rendering, language and screen-reader/device layout. No existing source files were changed by this feature module.
