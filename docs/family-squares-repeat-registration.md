# English Family Squares repeat registration — LOCAL ONLY

Base: `d1e79a445b33f1b5ae0562578759afcbe938437d` (`origin/main`, 4.2 HOLD DEPLOYMENT).
No push, deploy, EAS, OTA, production calls, or client contact was performed.

## Behavior

Today, Support (`useSessions`), and English onboarding all ensure registration rather than toggle/delete. Every tap, including a cached `going` tap, calls the authoritative bridge. Exact repeat copy:

> You’re already registered. We look forward to seeing you Monday evening!

Only the website's explicit `already_registered: true` produces this copy. Website auto-registration is therefore detected without exposing an arbitrary-email lookup to the frontend. Creation marks going without the repeat claim. A missing endpoint, malformed response, wrong occurrence, unverified email, network error, or native save error produces the existing visible RSVP failure; there is no silent direct-upsert fallback. Other sessions and La Sobremesa cancellation remain unchanged.

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
- An ensured registration survives the existing complete-batch snapshot arriving before the native RSVP save (or after a failed native save). Do not delete it merely because it is momentarily absent from that snapshot.
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

## Release blockers / ordered dependencies

1. Keep the existing 4.2 deployment hold. Obtain separate release authorization.
2. Website owner completes/reviews/tests the exact secret-auth ensure action, concurrent provider/email idempotency, and batch coexistence above. No end-to-end completion is claimed here.
3. Full app migration-chain/RLS integration gate; apply the new occurrence/reset migration before the new function/client (new column is required).
4. Deploy authenticated `family-squares-register` with existing website bridge secret/URL and gateway JWT check; verify isolated/non-client test accounts against deployed website contract.
5. Only then release native changes through the separately authorized binary/OTA process. Device UI, accessibility, offline and account-transition testing remain release checks.

Reverting the client code would restore destructive toggle behavior; do not use rollback as a registration cancellation mechanism. Leave additive schema in place unless separately reviewed.
