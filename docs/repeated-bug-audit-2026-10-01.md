# Repeated bug audit — reviewed release closure (2026-10-01)

## Scope and disposition

The parent completed three independent, scoped reviews and accepted the final pagination review (delegation `65d99ca4`) against the final backend tree. No unresolved significant finding remains in that reviewed scope. This is not a claim of exhaustive correctness, native-device validation, or production deployment.

Starting main: `5e45c837d06a37e2226b411641d7dfb6fb61be1f`. Release packaging retains marketing version **4.0**, increments only iOS build **2 → 3**, and adds `release-4-0-3` extending production with `autoIncrement: false`. The refreshed EAS iOS build list showed 4.0(2) latest and no 4.0(3). Android and package versions are unchanged.

## Completed repairs

- Offline queue: reject capacity overflow without deleting saved work; retain HTTP 408/429 retries, including numeric error-code strings; fence hydration, replay, and callbacks across account changes.
- Account isolation: mask stale chat/appointment state on the first account render; fence history/realtime/mutations, attachment continuations, checkout URLs, drafts and caller effects; recover rejected asynchronous operations.
- Invitation continuity: refresh account-local day snapshots and guard late callbacks, forecast writes, and stale-day actions.
- Rehearsal/media/membership: guard asynchronous identity lifetimes, audio/stage transitions and cleanup, prevent stale purchase continuations, and retain deterministic crisis guidance when the model fails.
- Notifications/backend: enforce consent and legacy sender boundaries, retry-safe per-recipient reservation/lease semantics, accurate delivery accounting, constrained authorization, family deletion behavior, and complete keyset pagination. Short API pages drain to empty; malformed/repeated/error pages terminate safely.
- All seven approved UI areas are implemented: support hierarchy, safe urgent support access, plan/review/booking clarity, practice setup and disclosure, invitation/trajectory clarity, navigation/accessibility/localization, and touch-target/error-retry polish. Changes include EN/ES copy and selection/expanded state contracts; no new product scope was added during packaging.

## Verification evidence and limitations

| Gate / evidence | Reviewed result |
|---|---|
| Complete final application suite | 595 TypeScript + 227 JavaScript tests = 822 passed; zero failures |
| TypeScript | PASS |
| Expo Doctor | 18/18 checks passed in audit; repeated in packaging gate |
| Dependency release audit | PASS under existing accepted-advisory policy, not zero advisories |
| Web export | PASS; synthetic/local test configuration, not production deployment |
| Deno 2.3.7 edge entrypoint check | PASS, 26 entrypoints |
| Deno shared contract suite | 133 passed, zero failures |
| Actual dispatcher handler regressions | 228/228 passed, synthetic IO |
| Legacy sender boundary suite | 109/109 passed |
| Isolated migration replay | All 94 repository migrations applied in disposable local stack |
| pgTAP | 34 files, 823 assertions, PASS |
| Concurrent database reservations | Four real two-session lock-contention cases; one claim only, fixtures removed |
| PostgREST boundary probes | 15 boundary cases plus 9 failure cases, per independent review |
| Browser UI | Core 48 checks; expanded 64 and 52 checks after touch-target repairs, all passing; EN/ES, 320/375 widths, synthetic free/Premier accounts |
| Independent review | Three scoped independent checks accepted by parent; final pagination tree cleared |

Evidence resides outside Git in `/root/.hermes/cache/scratch/`: `pagination-fix/` (handler, legacy, Deno, pgTAP and concurrency logs, snapshot hashes); `sh-ui7-touch-close/`, `sh-ui7-touch-close-extra/`, `sh-ui7-touch-close-edge/`; and `sh-release-*` packaging logs/receipt. Earlier failing browser logs are baseline evidence superseded by the touch-close results, not unexplained final failures.

Hook suites execute real transpiled modules with deterministic React/IO doubles. Browser requests are intercepted with synthetic fixtures. No real member records were inspected. No physical-device proof exists for VoiceOver/Dynamic Type, microphone/audio interruptions, camera/LiveKit, native push delivery, purchase/restore, or account transitions under native scheduling. These remain post-rollout device acceptance checks, not claims established by passing unit/browser tests. At-least-once transport/provider failures cannot be represented as exactly-once delivered notifications merely because reservations pass.

## Required coordinated backend rollout — NOT performed

Before production acceptance testing, an explicitly authorized operator must apply these migrations in order and deploy the corresponding handlers from the same reviewed release:

1. `20261001165431_audit_push_delivery_and_family_delete.sql`
2. `20261001174032_dispatcher_delivery_contract.sql`
3. `20261001183355_notification_recipient_leases.sql`

Handlers: `daily-nudge`, `notify-chat-message`, `notify-daily-morning`, `notify-family-backup`, `notify-session-reminder`, `rehearsal-partner`, `send-engagement-push`, with their shared helper changes. Verify linked migration history, RPC privilege/response contracts, scheduled delivery/lease configuration and synthetic authorized smoke results before enabling production testing. A new iOS binary alone does not deploy these changes. Do not claim production is repaired until rollout and read-back succeed.

Pages and Supabase automatic deployment workflows honor `[hold deployment]` on the final pushed head commit. Preserve that marker; manual dispatch bypasses the hold and is not authorized here. No manual backend deployment, OTA publication, public App Store submission, legal agreement acceptance, or key replacement is authorized in this release task.

## Packaging and release receipt

Packaging reruns the exact app/CI gates after metadata and this report change: clean dependency installation, release dependency policy, production-mock exclusion, typecheck, full app tests, Doctor, web export, Deno checks/contracts, and whitespace validation. Database evidence is from the independently verified identical backend tree and remote CI additionally exercises a clean stack. Any reproduced release blocker requires review rather than unreviewed code repair.

The release operator records final gate exit codes, exact independently read-back main SHA, EAS build ID/source SHA/profile, artifact/status, and submission ID/Apple state in an **external** `sh-release-receipt.json` and companion report. This avoids changing the clean build source during cloud execution. At report commit time, a build and submission are not yet claimed. A finished IPA, scheduled upload, successful upload and Apple/TestFlight processing are separate states requiring separate evidence. Submit only the exact new build ID; do not rebuild to fix Apple credentials or agreements.

All changed/untracked paths were inventoried and classified as approved implementation, tests, migrations, or release metadata. Scratch artifacts, credentials, private keys and environment files are excluded. The report and final external receipt are queued using the user's output-backup helper; queueing is not proof of remote backup completion.
