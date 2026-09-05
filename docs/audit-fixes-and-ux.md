# Audit fixes and approved UX improvements

## Scope

Repairs cover account-scoped hydration and storage, truthful booking/history/provider errors, account-fenced late submissions, cold deep links, auth confirmation rendering, media activation/teardown, unsupported provider filters and narrow-screen overflow.

Backend repairs cover family INSERT attribution and source-wall ownership through both table/RPC paths; SSO token issuance; atomic stable membership mirrors; production-vs-sandbox RevenueCat validation and authenticated authoritative lifecycle webhook; leased outbox delivery and checked completion. Duplicate external delivery is still possible after a receiver accepts a request but the acknowledgement is lost: receivers must honor the stable idempotency key. Existing historical payment events are not rewritten.

Approved UX 1–6: immediate help before promotions, progressive Today sections, four-step check-in with Back/retained answers and optional note, intent-based Tools entrypoints, plain-language boundary explanations, and local free/paid clarification. English and Spanish keys remain paired. Emergency help remains outside membership gates. Radio/disclosure states use both native and web accessibility props.

## Final local verification

- TypeScript passes.
- Complete app suite: 169 TypeScript and 67 JavaScript tests pass.
- Fresh full migration replay, then pgTAP: 17 files / 354 assertions pass.
- All Edge Function entrypoints type-check under pinned Deno 2.3.7; all 26 shared tests pass.
- Expo Doctor: 18/18 checks pass.
- Dependency release audit passes its existing policy; accepted Expo build-tool advisory chain remains documented by that policy. This is not a claim of zero dependency advisories.
- Web, iOS and Android JavaScript/Hermes exports succeed. Android export warns that local google-services.json is absent; this is not a signed/native build or device test.
- Local Chromium: 134 route/layout/storage/sequential-check-in checks pass at 320px/390px, plus 8 targeted UX interaction checks; no uncaught browser exceptions in those runs. Local check-in values were independently read back from PostgreSQL.
- Independent final backend/workflow and UX reviews found no confirmed blockers within their scope.

The tests use disposable local accounts and databases, not production data. Callback/native doubles are not a substitute for physical camera, microphone, push or purchase verification.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run doctor
npm run audit:release
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder npm run export:web
npx --yes deno@2.3.7 check --frozen --node-modules-dir=none supabase/functions/*/index.ts
npx --yes deno@2.3.7 test --frozen --node-modules-dir=none supabase/functions/_shared/*_test.ts
```

In a separate disposable Supabase project with unique local ports, copy the final migration/test/function tree, then start, reset with `--local`, and run `supabase test db` using pinned CLI 2.109.1. Never reset a linked/production project. The final audit snapshot matched repository backend files byte-for-byte; local configuration only changes isolation settings.

Optional browser scripts: `scripts/audit-browser-smoke.cjs` and `scripts/audit-ux-smoke.cjs`. Install Playwright/Chromium outside the repo, provide `PLAYWRIGHT_MODULE`, and provide `AUDIT_STORAGE_STATE` for a disposable local onboarded account. The main smoke expects no existing daily check-in in either database OR that browser's local cache. It explicitly edits the local Safety Wallet and saves one check-in. Scripts reject non-loopback app URLs and block external non-read requests. Do not commit browser storage state or credentials.

## Code-only GitHub handoff

A main commit containing `[hold deployment]` runs quality checks but skips that push's Pages deployment and Supabase migration stage (therefore function deployment). This is a per-commit hold, not a permanent production lock. A normal later push or approved manual workflow dispatch can deploy pending changes. The reusable quality concurrency group is isolated by workflow so standalone and deployment-called gates do not cancel each other.

No App Store, EAS or OTA release is included. Before live rollout, provision and verify the RevenueCat webhook secret, correct project/apps and test-account allowlist as documented in `supabase/functions/revenuecat-webhook/README.md`. Backfill existing stale entitlement mirrors explicitly; webhook deployment alone does not replay history. Verify actual migrations/functions and provider delivery after an approved deployment.
