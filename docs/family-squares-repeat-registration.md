# English Family Squares repeat registration

Released with 4.2 (2) (2026-10-24 audit). The website's ensure action is not live
yet (its migration 20261012224330 is unapplied), so until it is, every tap takes
the fallback below and nobody sees the repeat message; RSVPs reach the website
through the 15-minute batch exactly as 4.1 RSVPs do.

## Behavior

Today, Support (`useSessions`), and English onboarding all ensure registration rather than toggle/delete. Every tap, including a cached `going` tap, calls the authoritative bridge. Exact repeat copy:

> You’re already registered. We look forward to seeing you Monday evening!

Only the website's explicit `already_registered: true` produces this copy (now the i18n key `common:familySquares.alreadyRegistered`). Website auto-registration is therefore detected without exposing an arbitrary-email lookup to the frontend. Creation marks going without the repeat claim. The website's own decisions (`meeting_cancelled`, `registration_unavailable`) produce the visible RSVP failure. Any other website answer (no ensure action yet, outage, timeout, malformed or wrong-week reply) falls back to saving the RSVP snapshot alone, with `already_registered: false`; the existing 15-minute `family-squares-web-sync` batch then registers it on the website. An unverified email or native save error still fails visibly. Other sessions and La Sobremesa cancellation remain unchanged.

## Pinned website contract (dependency, separate owner)

App function `family-squares-register`: authenticated POST with `{}` only. Auth `getUser(bearer)` supplies verified email and Auth ID; accounts are queried by `user_id`, not client-supplied account identity. Anonymous/unverified users and nonempty bodies are rejected. Canonical occurrence comes from existing `familySquaresSyncWindow`: Monday 19:00 America/Los_Angeles, current call through its 20:00 end, next week thereafter. Client clocks/session dates cannot choose server occurrence.

Server POST to existing website `app-family-squares-sync`, using existing `WEBSITE_FUNCTIONS_URL` and `MEMBERSHIP_SYNC_SECRET` (`x-membership-sync-secret` header):

```json
{
  "action": "ensure-registration",
  "meeting_date": "2026-10-12",
  "attendee": { "email": "verified@example.test", "name": "Example Family" }
}
```

Required successful response, after durable exact-week registration:

```json
{ "ok": true, "already_registered": true, "meeting_date": "2026-10-12" }
```

`already_registered` must be a boolean; `meeting_date` must exactly equal the requested date. New registration returns false. Errors are non-2xx and/or `ok:false`. App timeout is 20 seconds; ambiguous failure is safe to retry. No website body/PII/secrets are returned to the frontend or logged.

Website owner must ensure:
- Idempotency across website auto-registration, native ensure, old batch sync and concurrent retries, keyed by normalized email + exact English occurrence.
- Existing durable registration returns true without provider registration or confirmation-email replay; creation returns false only after durable success.
- A new ensured seat is an `app` row (website `ensure_monday_app_registration`, 2026-10-24), so it gets no marketing, lead scoring or follow-up. Because the app saves its RSVP right after ensuring, the next batch snapshot keeps the row; a snapshot that races the save at worst removes it until the following run re-creates it.
- Secret required for the new action; do not expose public email enumeration. Existing batch payload/behavior remains compatible.

There is intentionally no new public lookup action, provider API call, email sender, or broad authentication mechanism on the app side.

## Occurrence snapshot / reset

Migration `20261012224545_family_squares_registration_occurrence.sql` was generated with the Supabase CLI. It adds nullable `session_rsvps.family_squares_meeting_date`. Legacy rows remain null, never inferred as completed registration. Client snapshot fields are protected by a BEFORE trigger; authenticated/anon writes cannot fabricate or advance the date. Existing RLS and RSVP permissions remain unchanged.

After website acceptance the service upserts the existing `(session_id,account_id)` row with status, exact occurrence, and current timestamp (needed by the unchanged batch's `p_since` filter). Today/Support display going only for a matching occurrence. Cached going is never trusted when deciding repeat versus new. A response crossing Monday call-end is rejected for retry.

Tuesday 02:00 Pacific reset now deletes English null/expired snapshots but preserves next Monday's confirmed row. The La Sobremesa future-link rule and unrelated sessions are unchanged. A website success followed by native save failure is not claimed as app success; retry reconciles the same website registration.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed, including the new 30 actual-handler/client/hook/callback tests.
- `node --test tests/family-squares-registration.test.mjs` — 30/30 passed. Synthetic IO, not real provider/device tests.
- `AUDIT_BASELINE_REF=d1e79a445b33f1b5ae0562578759afcbe938437d node --test tests/family-squares-registration.test.mjs` — seven expected failures in baseline Today/Support/onboarding behavior, without changing shared files.
- `npx --yes deno@2.3.7 check --frozen --node-modules-dir=none supabase/functions/family-squares-register/index.ts` — passed against CI's pinned runtime and unchanged lockfile.
- `python3 scripts/test-family-squares-registration-db.py` — passed actual PostgreSQL 17 migration application, deterministic Tuesday reset, future/legacy/Spanish/other controls, protected snapshots and composite-PK retries; isolated no-network/no-host-port container removed. This is a minimal-schema delta check, NOT full migration replay or live RLS integration.
- `git diff --check` — passed.

## Release status (2026-10-24)

1. Released by Matt's go-ahead with 4.2 (2): migration 20261012224545 and `family-squares-register` deploy with the merge to main.
2. The website ensure action goes live when the website's Monday registration migrations (20261012224330, 20261012230630) are applied through Lovable; nothing in the app changes then.
3. Do one English RSVP on a real 4.2 (2) device (Hermes `formatToParts` with `hourCycle: 'h23'`).

Reverting the client code would restore destructive toggle behavior; do not use rollback as a registration cancellation mechanism. Leave additive schema in place unless separately reviewed.
