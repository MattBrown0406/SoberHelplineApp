# RevenueCat authoritative lifecycle reconciliation (UNDEPLOYED)

The webhook is a wake-up signal, not a purchase receipt. It verifies a dedicated
shared-secret Authorization header, extracts account UUIDs (including both sides
of transfers and aliases), fetches RevenueCat REST v1 subscriber state, and runs
exactly the same validator and service-only SQL reconciliation as app-triggered
sync. Refunds, revoked/expired subscriptions and removed sandbox eligibility
therefore remove RevenueCat mirrors on successful delivery, without opening the
app. Other access sources are untouched. Transient/malformed upstream responses
return non-200 and preserve prior access for retry; a valid 404/empty state revokes.
Repeated notifications are safe; event payment amounts/tiers/expiry are ignored.
This does NOT produce payment analytics from access mirrors.

## Operator setup — required before claiming lifecycle coverage

Nothing here has been deployed or applied to production.

1. Review/apply the two UNAPPLIED `20260905020327` and `20260905020349` audit
   migrations through the normal approved process; clean-reset/test first.
2. Set a new high-entropy `REVENUECAT_WEBHOOK_SECRET` in the app Supabase Edge
   Function secrets. Do not reuse a user JWT, anon key or service-role key.
   Missing/empty secret fails closed (503); wrong Authorization fails (401).
3. Ensure `REVENUECAT_SECRET_API_KEY` belongs to the correct RevenueCat project
   and can read REST v1 subscriber records. Supabase URL/service-role key must
   exist server-side. Never put these in Expo/client environment variables.
4. Deploy `revenuecat-webhook` with its checked-in `verify_jwt = false` config
   (external RevenueCat Authorization is not a Supabase JWT). Deploy updated
   `sync-iap-entitlements` and their shared modules together.
5. In the correct RevenueCat project: Integrations → Webhooks → Add configuration.
   URL: `https://<APP_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`.
   Authorization header: exactly `Bearer <REVENUECAT_WEBHOOK_SECRET>`.
   Select the actual app(s) used by SoberHelpline and all lifecycle event types,
   including CANCELLATION, EXPIRATION, TRANSFER and REFUND_REVERSED. Enable
   production and sandbox if supporting TestFlight. Do not filter away refunds.
   The project ref, RevenueCat app IDs and dashboard permissions have NOT been
   verified here: obtain them from the operator; do not guess based on names.
6. Verify canonical products `sh_essential_monthly` / `sh_premium_monthly` map to
   entitlements `essential` / `premium` in those apps. Set server-controlled
   `REVENUECAT_SANDBOX_ACCOUNT_IDS` for testers as needed. The confirmed reviewer
   email exception remains identical in app sync and webhook reconciliation.
7. Send the dashboard TEST (200 expected), then use a synthetic test account for
   a real sandbox purchase/refund/expiration/transfer. Read back entitlements and
   confirm revocation without app launch, stable row IDs on repeats, preservation
   of web/scholarship access, and no mirror-generated payment outbox events.
8. Monitor non-200 delivery history and manually retry failed notifications after
   fixing outages. RevenueCat retries at 5/10/20/40/80 minutes, then stops. Delivery
   is not an instantaneous or guaranteed scheduler. Existing stale users require
   explicit authoritative reconciliation/backfill; deploying alone creates no
   historical events. Allowlist edits also require reconciliation of affected IDs.

No historical outbox payments are deleted or rewritten. Existing Stripe/coaching
payment trigger paths are preserved; a real RevenueCat payment feed needs verified
processor transaction IDs/amounts and is intentionally outside this change.
The validator matches REST-v1 product/purchase date, store, environment, refunds
and expiry; it does not claim exact transaction-ID or app-ID verification.

## References checked during this audit

- https://supabase.com/changelog.md (no relevant breaking change found)
- https://supabase.com/docs/guides/functions/auth.md — external webhooks disable
  gateway JWT validation and authenticate the provider inside the handler.
- https://www.revenuecat.com/docs/integrations/webhooks — dashboard Authorization,
  environment/app filters, HTTP 200 acknowledgement and finite retry schedule.
- https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields —
  cancellation is not automatically expiration; use authoritative current state,
  and reconcile transfer source and destination identities.

Local checks: `npx --no-install deno test supabase/functions/_shared/*test.ts`;
`npx --no-install deno check supabase/functions/revenuecat-webhook/index.ts
supabase/functions/sync-iap-entitlements/index.ts`; run pgTAP family/edge tests and
full migration replay in the isolated local Supabase stack before rollout.
