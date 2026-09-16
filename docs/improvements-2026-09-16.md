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
