# Repeated bug audit — implementation handoff (2026-10-01)

## Status and boundary

**Partial first implementation audit, not a repository-wide all-clear.** The repaired client flows below have deterministic failing-baseline/passing-fix evidence and final application gates. Independent review and the remaining backend/media/product-flow audit are still required before the parent agent's final handoff.

- Repository: `MattBrown0406/SoberHelplineApp`; branch: `fix/repeated-bug-audit`.
- Starting revision: `5e45c837d06a37e2226b411641d7dfb6fb61be1f`, clean at start, already updated by the parent.
- Read the existing `docs/audit-fixes-and-ux.md` first. Its earlier verification is historical evidence, not a new execution claim.
- No push, deploy, production database/function mutation, private-record inspection, EAS, OTA, or native release performed.
- Existing QA containers were inventoried but not reset or changed.

### Deployment holds inspected before edits

`deploy-web.yml` automatically deploys Pages on main pushes. `supabase-functions.yml` automatically migrates/deploys on matching main changes. Both honor `[hold deployment]` on the **head commit of that push**. Manual dispatch bypasses the hold. `migration-drift.yml` can perform read-only linked history checks; no linked command was run here. Workflows were left unchanged and every local audit commit includes the hold marker. Preserve it on the final main head if the handoff must remain code-only; the marker is not a permanent production lock.

## Finding and closure ledger

| ID | Severity | Confirmed defect | Repair and executable evidence |
|---|---|---|---|
| A1 | High/data loss | Enqueuing item 201 silently deleted the oldest work previously reported as saved. | Reject `outbox_full` without modifying the stored envelope. Duplicate retries at capacity remain idempotent; freeing a slot permits retry. `tests/offline-outbox.test.ts`. |
| A2 | High/data loss | HTTP 408/429 replay failures were classified as permanent and deleted pending items. The code-string `429` also matched the broad SQL `42` prefix. | Treat numeric HTTP timeout/throttle statuses and code strings as retryable. Assert ordered queue retention and no dropped records. Same test file. |
| A3 | Medium/data integrity | Invitation engine clock advanced but its daily snapshot did not. Yesterday's moves/check remained active and writes used yesterday's date. Late checks could contaminate a new day; retained callbacks could submit after an account switch. | Reload on account-local date changes; hide expired snapshots; fence callbacks, completions and forecast writes by account/day lifetime. `tests/invitation-engine-lifecycle.test.mjs`: midnight, stale callbacks and delayed checks. |
| A4 | High/privacy | `useThread` returned A's private messages/thread on the first render for B. Old history, realtime callbacks and send completions could repopulate the next account. | Mask state before identity effects, reset scoped state, fence reads/realtime/mutations and attachment continuation; reject stale/disabled send and reaction callbacks. `tests/account-sensitive-hooks.test.mjs`. |
| A5 | High/privacy | `usePrivateVideoSessions` returned A's appointment notes on B's first render. A's mutation could call its old loader under B's current session; late checkout URLs could escape to the new account. | Account/access lifetime tokens, immediate output masking, guarded reloads/mutations/checkout URLs and unmount invalidation. Same lifecycle suite. |
| A6 | Medium/reliability | Rejected appointment RPC/checkout promises left loading/mutating true, and effect-driven loads could reject without handling. | Catch rejected promises separately from returned Supabase errors, expose existing localized retryable error keys, settle flags in scoped finally blocks. Same lifecycle suite. |

These are client-state repairs, not replacements for server RLS or proof that a request already in flight was canceled. Native rendering, account-transition caller UI, real purchase providers and live attachment transport require independent/device checks.

## Iterations and evidence

1. **Baseline:** `npm ci` succeeded; original complete app suite passed. Initial typecheck failed because this existing clone's ignored `.expo/types` declarations were stale. Web export did not regenerate them. `npx expo customize tsconfig.json` regenerated the declarations; typecheck then passed without a tracked tsconfig change. This was local generated-state drift, not a source-code repair.
2. **Offline queue audit:** two new regressions failed before changes (missing capacity rejection; two records dropped on transient failure). Both passed after repair. A second classification review found the numeric `429`/SQL-prefix overlap and expanded coverage to status and code shapes.
3. **Invitation daily lifecycle:** all three new tests failed before repair; all passed after repair. Follow-up review added unmount/identity and real-current-date guards to late callbacks and forecast writes.
4. **Sensitive account transitions:** a standalone deterministic probe reproduced both chat and appointment first-render disclosure with dummy A/B records. The committed seven-test suite was then run against pre-fix source via `AUDIT_BASELINE_REF=7064cbe`; all seven tests failed. The final source passes all seven, including late realtime/history/send, stale mutation/checkout, and rejection cleanup.
5. **Final local gate:** reran the complete application tests and typecheck after the last hook edit, then exported a fresh web bundle. No additional significant defect was confirmed in this final bounded review of the repaired paths. This does **not** mean every requested domain has been exhaustively audited.

The hook tests execute transpiled real modules with deterministic React/IO doubles. They are lifecycle-contract tests, not rendered browser/native UI tests. Regression fixtures contain no real member data.

## Gate results

| Gate | Actual result |
|---|---|
| `npm ci` | PASS; no package/lockfile changes |
| `npm test` after final hook edits | PASS: 486 TypeScript tests and 110 JavaScript tests, zero failures |
| `npm run typecheck` after final hook edits | PASS |
| `npm run doctor` | PASS: 18/18 checks |
| `npm run audit:release` | PASS under existing accepted-advisory policy; not zero advisories |
| Web export after final hook edits | PASS; fresh artifact at `/root/.hermes/cache/scratch/sh-audit-web-final` |
| Deno 2.3.7 `check --frozen --node-modules-dir=none supabase/functions/*/index.ts` | PASS; 26 entrypoints, backend source unchanged afterward |
| Deno 2.3.7 `test --frozen --node-modules-dir=none supabase/functions/_shared/*_test.ts` | PASS: 133 tests, zero failures |
| Full migration replay and pgTAP | **NOT RUN.** The proposed isolated local-stack preparation/start command was held for tool security approval before execution; no existing stack was reset. |
| Native builds, device media/push/purchases, browser interaction | NOT RUN in this pass |
| Git whitespace checks | PASS before each implementation commit; rerun for the final staged report |

Logs are local under `/root/.hermes/cache/scratch/sh-*.log` (not committed). Key files: `sh-outbox-red.log`, `sh-invitation-red.log`, `sh-account-hooks-red.log`, `sh-final-test.log`, `sh-final-typecheck.log`, `sh-final-web.log`, `sh-doctor.log`, `sh-audit-deps.log`, `sh-deno-check.log`, `sh-deno-test.log`.

## Reproduction

```sh
export PATH=/root/.hermes/node/bin:$PATH
npm ci
# Needed in this reused clone to refresh ignored stale route declarations:
npx expo customize tsconfig.json
npm run typecheck
npm test
npm run doctor
npm run audit:release
CI=1 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  EXPO_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder \
  npx expo export --platform web --output-dir /root/.hermes/cache/scratch/sh-audit-web-final
npx --yes deno@2.3.7 check --frozen --node-modules-dir=none supabase/functions/*/index.ts
npx --yes deno@2.3.7 test --frozen --node-modules-dir=none supabase/functions/_shared/*_test.ts
# Expected NONZERO: validates the regression tests against pre-fix hook source
AUDIT_BASELINE_REF=7064cbe node --test tests/account-sensitive-hooks.test.mjs
```

## Independent-review checklist / unfinished scope

- [ ] Review `useAsyncScope` render/effect/unmount lifecycle and both consumers under real React/native scheduling, same-user refresh, A→B→A, access revocation, and delayed storage/network/realtime responses.
- [ ] Audit **callers' local form state and post-await effects**, not only repaired hooks: chat drafts/attachments, appointment forms, success alerts/navigation. Hook isolation alone does not establish screen-wide account isolation.
- [ ] Audit same-account overlapping loads/mutations and thread archive/reopen subscription callbacks; account lifetime fencing does not inherently serialize all same-account operations.
- [ ] Review invitation focus/midnight/timezone transitions, same-day concurrent edits from multiple mounted screens, safety freshness, and provider error behavior. Its five-minute clock remains the existing refresh cadence, with actions additionally checking the real current date.
- [ ] Rehearsal/media: inspect `invokeRehearsal` transient/401 retry loop across unmount/account changes, auth identity binding, microphone/audio teardown and continuation after safety pauses. This was source-reviewed but not exhaustively reproduced or closed here.
- [ ] Auth/offline/local storage: broader AccountContext bootstrap, protected multi-part stores, corrupt envelope recovery, queue deduplication constraints, and logout/reminder sequencing beyond existing tests.
- [ ] Notifications/reminders: real permission-dialog/foreground overlap, device token transfer, opt-in synchronization, delivery/read-back and privacy.
- [ ] Membership/payments: end-to-end source/provider lifecycle, checkout binding, refunds/revocations and sandbox/reviewer policy; this pass only reran existing contracts and fixed appointment checkout lifecycle.
- [ ] Backend authorization/SQL: create a new isolated project/database after approval, replay all 91 repository migrations, run all 29 pgTAP files, inspect final privilege/RLS/security-definer catalogs and test null/foreign principals and concurrent RPCs. Existing QA containers and linked production remain out of scope for reset.
- [ ] Complete independent invitation/AI-safety, admin/chat, scheduling/payment and backend reviews; rerun gates after any follow-up edits. Do not declare the requested repeated comprehensive audit complete from these passing tests alone.
- [ ] Parent owns final main reconciliation/push. Preserve the deployment hold and separately authorize any live release.
