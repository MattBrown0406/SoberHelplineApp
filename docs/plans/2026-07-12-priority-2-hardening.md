# Priority 2 hardening — phases 1–5

## Phase 1 — authorization and business-rule integrity

- `family_members` has no authenticated INSERT policy or table INSERT grant.
- `join_family_space(text)` is the only authenticated join path.
- The RPC validates the normalized invite code, derives the account from `auth.uid()`, and always inserts role `member`.
- `create_family_space(text)` remains the only owner-creation path.
- Legacy `SECURITY DEFINER` functions have fixed search paths and explicit execute grants.
- Transaction-wrapped pgTAP tests cover direct insert, invalid code, UUID substitution, role escalation, valid/idempotent joins, and anonymous callers.

Production membership audit (read-only, no PII fields):

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db query --linked --file scripts/audit_family_memberships.sql
```

The audit flags non-creator owners, missing creator-owner memberships, families over eight members, accounts in multiple families, impossible timestamps, and invalid roles. Historical rows cannot be conclusively attributed to REST vs RPC because the original schema did not record join source.

## Phase 2 — CI quality and critical-rule tests

`.github/workflows/quality.yml` runs on pull requests and `main`:

- clean `npm ci`;
- fail on high/critical npm advisories;
- reject production mock-module imports;
- TypeScript;
- Expo Doctor;
- web export;
- every Edge Function through Deno check;
- complete local Supabase startup/reset;
- all pgTAP tests.

## Phase 3 — dependency remediation

- Applied the non-breaking `npm audit fix` set.
- Pinned patched PostCSS `8.5.10` via npm override.
- Current production audit: zero critical/high findings.
- Remaining moderate advisories are in Expo 54's config/Xcode dependency chain. npm's proposed remediation is a breaking Expo SDK change and must be handled as a dedicated Expo SDK upgrade, not `npm audit fix --force`.

## Phase 4 — monitoring and production-data integrity

- Added `@sentry/react-native`.
- Monitoring activates only when `EXPO_PUBLIC_SENTRY_DSN` is configured.
- `sendDefaultPii` is disabled.
- User/request/extra payloads and breadcrumb data are removed before transmission.
- Production source no longer imports `src/api/mock.ts`.
- Static communication scripts and group definitions live under `src/content/`.
- On-call identity uses the configured real provider.
- The dormant placeholder AI-draft Edge Function was removed.

For symbolicated native events, configure the Sentry project variables and `SENTRY_AUTH_TOKEN` in EAS/CI. Do not put the auth token in `EXPO_PUBLIC_*` variables.

## Phase 5 — ordered deployment coverage

`.github/workflows/supabase-functions.yml` is now one ordered production workflow:

1. apply every pending migration;
2. only after migration success, deploy every checked-in Edge Function.

The workflow uses a non-cancelling production concurrency group so a newer commit cannot interrupt a migration in progress. No production deployment occurs from the feature branch.
