# Edge sync reliability rollout

Apply `20260905020349_edge_sync_reliability.sql` **before** deploying
`sync-web-membership`, `sync-iap-entitlements`, and `drain-spine-outbox`.
No production deployment or secret changes are included in this patch.

## RevenueCat contract and sandbox policy

Verified against https://www.revenuecat.com/docs/api-v1/customer-info-model:
`subscriber.entitlements` includes expired grants and has no `is_sandbox` flag.
Environment/store/refund state comes from `subscriber.subscriptions[product]`.
The entitlement's product identifier and purchase date must match that record;
expiry alone does not prove the transaction or its environment. Expiry is capped
by both records, including documented billing grace.

Repository products (`src/hooks/useIAP.ts`) are `sh_essential_monthly` and
`sh_premium_monthly`; entitlement keys are `essential` and `premium`. This patch
supports those monthly products in `app_store` / `play_store`, not arbitrary
promotional, web, lifetime, or unrelated products. Verify the live RevenueCat
product/store mapping before rollout; no dashboard configuration was accessed.
REST v1's entitlement record does not expose an app ID or transaction ID, so this
is product + purchase-date matching, not a claim of v2 app-ID verification.

Sandbox is denied by default except:
- The verified-email `appreview@soberhelpline.com` account, explicitly documented
  in `docs/appstore-review-notes.md` as needing sandbox purchases.
- Operator-selected account UUIDs in the Edge Function secret
  `REVENUECAT_SANDBOX_ACCOUNT_IDS` (comma-separated **accounts.id**, not auth user
  IDs). Configure current TestFlight testers before rollout. No client flag or
  user metadata can opt into this list. Do not put real paid customer accounts
  on it. Remove retired testers from the list.

Test the selected TestFlight/App Review build after configuration. The new
`revenuecat-webhook` uses authenticated server-triggered authoritative reconciliation
for refunds/revocations without app launch. It must be deployed and configured
by an operator; see `../revenuecat-webhook/README.md`. Delivery failures need
monitoring/retry. Existing stale mirrors and allowlist edits still need an explicit
authoritative backfill; deployment alone does not synthesize historical events.

## Stable mirror identities

Web/RevenueCat mirrors retain IDs on refresh, delete only revoked tiers, and use
a unique partial index scoped to those sources. Unchanged RC snapshots do not
update; web rolling expiry refreshes only below 34 days or on email change.
RevenueCat mirror inserts no longer fabricate zero-dollar payment events. Existing
Stripe and coaching paths and historical outbox records are untouched.

## Outbox semantics

One row is claimed immediately before send with a 60-second token lease, a
10-second HTTP timeout, 50-row / 45-second per-invocation loop bound, and six
attempts maximum (including crashes). Failures back off five minutes. Completion
is conditional on the still-live token, and errors/stale completions return 500
rather than reporting success. Attempts are recorded at claim time.

Delivery is **at least once**, not exactly once. The stable
`Idempotency-Key: soberhelpline-spine-<row id>` header must be honored by the hub
to deduplicate a successful HTTP send followed by a worker crash or DB failure.
Hub behavior has not been verified or changed. Expired final-attempt rows remain
failed for operator inspection/replay; no automatic infinite retry was added.

## Local verification

- `npx --no-install deno test --no-lock --node-modules-dir=none supabase/functions/_shared/edge-sync-reliability_test.ts`
- `npx --no-install deno check --no-lock --node-modules-dir=none supabase/functions/sync-web-membership/index.ts supabase/functions/sync-iap-entitlements/index.ts supabase/functions/drain-spine-outbox/index.ts`
- `supabase/tests/edge_sync_reliability_test.sql`: transaction-wrapped pgTAP
  rollback/revoke, source isolation, service-only grants, claim fencing, attempts,
  backoff and terminal behavior. Run against the full migration chain in the
  parent's isolated database. Initial worker validation used a separate
  PostgreSQL 17 container and a minimal affected-table baseline, not a full reset.
