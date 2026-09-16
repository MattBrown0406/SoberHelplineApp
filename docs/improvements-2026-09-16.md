# Five product improvements — 2026-09-16

Branch `feat/five-improvements-2026-09-16`. One section per feature, appended as each lands.
If this work is resumed after an interruption, continue from the first feature without a section below.

## 1. Offline outbox for check-ins and family-journal notes — DONE

**What changed**
- `src/lib/offlineOutbox.ts` — persisted per-account outbox (`@sober-helpline/outbox/v1:<accountId>`, versioned envelope
  like `offlineAccountCache`). Items carry a client uuid; `enqueue` dedupes by id, `replay` runs in enqueue order, stops at the
  first retryable failure (later items keep their place), drops permanent failures (data/constraint/permission codes), and treats
  `23505` unique violations as already-synced. Corrupt envelopes / items fail closed (never replayed; valid items kept).
  Per-account promise chain serializes read-modify-write. `subscribeOutboxReplay` lets screens flip "will sync" → synced.
- `src/hooks/useOfflineOutbox.ts` — replays on account known, AppState `active`, and `SIGNED_IN`/`TOKEN_REFRESHED`
  (same pattern as the AccountContext offline retry). Mounted once in `app/_layout.tsx` (`InitialLayout`).
- `src/hooks/useCheckIn.ts` — signed-in insert that fails with a retryable error is queued with its original
  `created_at`/`checkin_date`; streak/known-dates/local cache/nudge update as if it succeeded; exposes `pendingSync`.
- `src/components/today/CheckInCard.tsx` + `app/(tabs)/index.tsx` — quiet `checkIn.pendingSync` line under the done banner.
- `app/(tabs)/boundaries.tsx` — journal post uses a client uuid + `created_at`; retryable failure queues instead of alerting;
  queued notes render at the top of the journal with `journal.pendingSync`; replay reloads the list.
- Locale keys: `today.checkIn.pendingSync`, `boundaries.journal.pendingSync` (en + es).

**Decisions**
- Unknown errors are retried, not dropped — losing a member's check-in is worse than one extra replay.
- Queue capped at 200 newest items. Sign-out handling of the outbox is done in feature 5 (discard, stated in copy).
- Anonymous (signed-out) check-ins are unchanged — the device write was already authoritative.

**Verify**
- `npx tsx --test tests/offline-outbox.test.ts` (10 tests: enqueue/dedupe, order, partial failure, drop, corruption, isolation, serialization, events)
- `node --test tests/offline-outbox-checkin.test.mjs` (real `useCheckIn` against an offline Supabase double)
- Manual: airplane mode → check in → "Saved on this device…" → reconnect/foreground → line disappears, row exists in `checkins`.

## 2. Safety Wallet → shareable family emergency card, free for everyone — DONE

**What changed**
- `src/api/types.ts`, `src/lib/featureAccess.ts` — new `ProductFeature` `safetyWalletShare` → entitlement
  `canShareSafetyWallet`, `true` for every account state (and admin). `offlineAccountCache.isEntitlements` accepts
  caches written before the field existed, so an upgrade never fails closed into the offline fallback.
- `app/crisis-mode.tsx` — the Share/Export list in the crisis summary is gated on `useFeatureAccess('safetyWalletShare')`
  (was `hasEssential`), so free members no longer see an empty list. The Premier command-plan export is unchanged.
- `src/lib/safetyWallet.ts`, `app/safety-wallet.tsx` — new `treatmentContact` field (household group); merges onto
  defaults so stored plans stay valid.
- `src/lib/familyEmergencyCard.ts` — pure formatter. Five allowlisted sections (naloxone, treatment contact, agreed plan,
  contacts, boundaries) mapped to wallet fields; `availableEmergencyCardSections`, `emergencyCardBlocks`,
  `familyEmergencyCardText` (→ `''` when nothing selected has content). Always ends with localized 911/988 lines and
  the "not emergency care" note.
- `src/components/safety/FamilyEmergencyCard.tsx` — "Share with family": tick sections (none preselected) → preview →
  native share sheet (`Share.share`) or copy (`expo-clipboard`). Remounts on plan/account/locale change so a stale
  preview can't be shared. Rendered on the wallet screen above the existing selective export.
- Locale keys: `crisis.wallet.fields.treatmentContact`, `crisis.wallet.placeholders.treatmentContact`,
  `crisis.wallet.familyCard.*` (en + es).

**Decisions**
- Real entitlement rather than mapping to an unrelated one: the gate reads API-contract booleans, and "free for all"
  is a product statement worth encoding where the paid gates live.
- Private wallet fields (address, substances, overdose/suicide/weapons history, children, insurance, incidents,
  loved-one name) are excluded by construction — the card only knows the allowlist. Same preview-before-share policy
  as the selective export.
- Plain text only (no PDF) — the goal is a message a relative can read from a lock screen.

**Verify**
- `npx tsx --test tests/family-emergency-card.test.ts` (6: allowlist/no leak, selection, empty sections omitted,
  crisis footer, full es render with no English labels, ungated wiring)
- `npx tsx --test tests/feature-access.test.ts tests/safety-wallet-crisis-export.test.ts`
- Manual (free account): Crisis Mode → summary → Share/Export list is populated; Safety Wallet → "Share with family"
  → tick Narcan → Preview → Share opens the sheet; switch to Español and repeat — card is fully Spanish, 911/988 intact.

## 3. Every push tap routes to its screen — DONE

**What changed**
- `src/lib/pushRouting.ts` — the documented `data: { kind, ...ids }` contract lives in the header comment (table of
  kind → ids → destination). New kinds: `coach_message` → `/chat`, `member_message` → `/admin-thread` (coach device),
  `session_reminder` → Support with the RSVP'd `sessionId` (or a live room when `room_name` is allowlisted),
  `morning_note` / `daily_nudge` → a tab from an allowlisted `screen` hint (default Today), `winback` →
  `/guided-journey`. Existing kinds unchanged (`practice_incoming`, `situation_brief`, `family_backup`, `group_live`,
  `*_video_*`). `getPushDestination(data, { nowMs, entitlements })` consults `featureAccess` — chat needs
  `coachMessaging`, live rooms need `community`, private video needs `privateVideo`; otherwise the tap lands on Support.
  Unknown/legacy payloads (no kind, bad ids, arbitrary `screen`/`deep_link`) open the app on a tab; the only
  discarded tap is an expired or malformed practice call.
- `src/api/types.ts`, `src/lib/featureAccess.ts` — `coachMessaging` and `privateVideo` product features so the
  router reads the same map the screens use.
- `src/hooks/usePushNotifications.ts`, `app/_layout.tsx` — entitlements are passed into the tap handler.
- `app/(tabs)/support.tsx` — reads `sessionId` from params and tints that session card.
- `supabase/functions/_shared/push-data.ts` (+ `_test.ts`) — producers build payloads through typed helpers; ids are
  attached only when they are uuids. Used by `notify-chat-message` (thread id), `notify-session-reminder` and
  `send-engagement-push` `session_reminder` (Family Squares session id via `family_squares_session_id()`),
  `send-engagement-push` `winback`, `notify-daily-morning`, `daily-nudge`, `notify-family-backup` (wavering event id).
  No edge functions were deployed.

**Decisions**
- `family_backup` stays on Boundaries (spec suggested crisis-mode/support): the wall and its backup notices live there.
- SQL-side `push_outbox` metadata for video kinds still carries legacy `screen`/`deep_link` keys; the client ignores
  them (kind wins) so no migration was needed.
- Personal (local) reminders keep an empty payload; the tap opens Today.

**Verify**
- `npx tsx --test tests/push-routing.test.ts` (16, incl. a test that every contract kind is routed and every producer
  imports the shared builder)
- `npx --yes deno@2.3.7 test --frozen --node-modules-dir=none supabase/functions/_shared/*_test.ts` (29)
- Manual: send a test push with `{ "kind": "coach_message" }` to an Essential device → Chat opens; to a free device
  → Support opens. `{ "kind": "nonsense" }` → app opens on Today.

## 4. Spanish end-to-end — DONE

**What changed**
- `app/crisis-mode.tsx` (49 strings), `src/components/scripts/ScriptCard.tsx` (4), `src/components/safety/EmergencyActions.tsx` (2)
  — every `isSpanish ? 'es' : 'en'` copy ternary moved to `t()` keys (`crisis.inline.*`, `crisis.emergency.offlineNote`/
  `buttonHint`, `scripts.inline.*`; `{{tier}}` / `{{count}}` interpolation where the string was templated). The only
  remaining `isSpanish` use is the `consentLocale` value.
- `src/hooks/useFamilySpace.ts` — takes `{ you, member }` labels (no more `'Member'`/`'You'` defaults);
  `family_spaces.name` now stores the owner's first name only (language-neutral) and the hook exposes
  `space.ownerName` (`familySpaceOwnerName` strips the legacy `"'s Family"` suffix). Format with
  `boundaries:journal.spaceTitle` ("{{name}}'s Family" / "La familia de {{name}}").
- `app/(tabs)/index.tsx`, `app/(tabs)/boundaries.tsx` — pass localized labels; `createFamilySpace(firstName)`.
- `app/book-coaching.tsx` — date chips use `es`/`en-US` from `i18n.language`; `Contact:` prefix →
  `support:coaching.contactNotePrefix`.
- `src/components/ErrorBoundary.tsx` + `src/lib/errorBoundaryCopy.ts` — crash fallback reads `common.errorBoundary.*`
  straight from the bundled locale files (works before/without i18n), picks language from i18n or the device locale.
- `app/rehearsal.tsx` (mic/recording alerts), `app/video-session.web.tsx` (web-only notice) — localized.
- Locale keys added in en + es: `crisis.inline.*`, `crisis.emergency.{offlineNote,buttonHint}`, `scripts.inline.*`,
  `boundaries.journal.{member,spaceTitle}`, `support.coaching.contactNotePrefix`, `common.errorBoundary.*`,
  `rehearsal.{microphoneNeededTitle,recordingErrorTitle,recordingErrorFinish,recordingErrorReset}`.

**Decisions**
- Admin/coach screens (`app/admin*.tsx`, `src/components/admin/*`) stay English — coach tooling, not member-facing.
- Locale parity is enforced generically rather than per-namespace: `tests/locale-parity.test.ts`.

**Verify**
- `npx tsx --test tests/locale-parity.test.ts` (30: file twins, i18next registration, per-file key/type/placeholder/
  911-988 parity, "translated not copied" for every multi-word string, es crash fallback, no copy ternaries on
  member screens)
- Manual: Settings → Español → Crisis Mode, Scripts, Book a call, Safety Wallet; force a render error → Spanish fallback.

## 5. Family space survives its creator; sign out works offline — DONE

**What changed**

*(a) Succession on account deletion*
- `supabase/migrations/20260916120000_family_space_survives_creator.sql` — `BEFORE DELETE` trigger on
  `public.accounts` (`transfer_family_spaces_before_account_delete`, SECURITY DEFINER, not executable by clients).
  For every space the account created: hand `created_by` to the **longest-standing remaining member** (earliest
  `family_members.joined_at`, ties by `id`), mark that member `role = 'owner'`, rename the space to the successor's
  first name (the UI renders `"<first name>'s Family"`; old name kept if they have none); delete the space only when
  no other member remains. `family_spaces.created_by` FK switched from `ON DELETE CASCADE` to `ON DELETE RESTRICT`
  so a dropped trigger fails loudly instead of silently wiping a family.
- RLS unchanged: `owner update` / `creator select` key on `created_by`, `member select` on membership, so the
  successor gains owner rights the moment the row moves. `delete_own_account` untouched — it deletes `auth.users`,
  the cascade reaches `accounts`, and the trigger fires inside that cascade.
- `supabase/tests/family_space_succession_test.sql` (18 pgTAP assertions, CI only): wiring (trigger, RESTRICT,
  privileges), creator deletes → space, invite code and shared walls survive, earliest member (not latest) becomes
  owner, `family_members.role` updated, RLS lets the successor rename and stops a non-owner, lone creator → space
  removed, non-creator deleting leaves ownership alone.

*(b) Offline sign-out*
- Finding: `supabase.auth.signOut()` (any scope) calls the server first and, on a network failure, **keeps the local
  session** — offline members were stuck signed in. Pinned by `tests/local-sign-out.test.ts` against the installed
  auth-js with an offline `fetch`.
- `src/lib/localSignOut.ts` — `signOutLocally(target, deps)` ordered: store pending revoke → discard the account's
  outbox → clear offline account cache → remove session (last, so nothing is replayed/re-cached afterwards; any earlier
  failure leaves the member signed in). `removeSessionLocally(auth)` uses auth-js's own `_removeSession()` (clears
  storage + memory, emits `SIGNED_OUT`) with a fallback to `signOut({ scope: 'local' })`. `outboxImpact()` counts what
  would be discarded.
- `src/lib/pendingPushTokenRevoke.ts` — versioned record `@sober-helpline/pending-push-token-revoke/v1`
  `{ version: 1, accountId, requestedAt }`, fail-closed reader; `settlePendingPushTokenRevoke(accountId, revoke)` →
  `none | revoked | retry | superseded`.
- `src/hooks/usePushNotifications.ts` — `revokePushToken`, `settleRevokeThenRegister`: on mount the pending revoke is
  settled **before** device registration (so a fresh token is never nulled by a late revoke); registration is skipped
  while the revoke is still pending; retried on app foreground, re-registering after a late success. A different
  account signing in supersedes the record (`register_push_device` already moves the token in one transaction).
- `src/contexts/AccountContext.tsx` — exposes `signOutLocally()` wired to the lib with the real outbox/cache/auth.
- `app/settings.tsx` — when clearing `push_token` or `signOut()` fails for an offline reason
  (`isOfflineFallbackError`), an alert offers **Stay signed in / Sign out anyway**, stating that signed-in details are
  erased, notifications for the account are turned off on the device at the next connected sign-in, and how many unsent
  check-ins / journal notes will be discarded. Non-offline failures keep the existing error.
- Copy (en + es): `settings.signOutOffline.{title,body,bodyWithQueue,cancel,confirm}`.

**Decisions**
- Longest-standing member over most-recent-activity: deterministic, needs no activity table, and is the person the
  rest of the family already knows.
- Space renamed to the successor's first name because the UI shows `"{{name}}'s Family"` (feature 4).
- Offline sign-out discards that account's queued writes rather than keeping them for a later session — a signed-out
  device should hold nothing for the account; the alert says so before confirming.

**Verify**
- CI: `supabase test db` runs `family_space_succession_test.sql` (no Docker locally).
- `npx tsx --test tests/local-sign-out.test.ts tests/pending-push-token-revoke.test.ts` (5 + 5).
- Manual: airplane mode → Settings → Sign out → "Sign out anyway" → app returns to sign-in; reconnect and sign in →
  `accounts.push_token` is nulled then re-registered; owner of a family space deletes account → members still see
  the space, earliest member is owner.

**Deferred**
- `shared_walls.proposed_by` still cascades: walls *proposed by* the deleted creator disappear (commitments to them
  too). Reassigning authorship is a product call.
- No "leave family space" UI exists; if one is added, the same succession must run when the creator leaves.
- Push token revoke for a *different* account that later signs in on the same device relies on
  `register_push_device` transferring the token; if that registration never runs (permission denied), the old
  account's token stays until its own next connected sign-in.
