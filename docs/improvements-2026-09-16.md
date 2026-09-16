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
