# Sober Helpline 3.8 (2)

User authorized implementation of seven proposed improvements and EAS/TestFlight distribution, not public App Store release.

## Acceptance ledger

1. Optional situation-first onboarding: worried, refuses help, treatment/homecoming, boundaries, urgent. Skip and immediate ungated crisis guidance. One relevant next step.
2. Boundary follow-through: communication, own action, review date, compassionate yes/not-yet/adjust follow-up. Account-scoped persistence and clear/delete.
3. Resumable guided journey: understand, boundary, practice, support. Existing functional destinations, explicit progress, no forced linear crisis access.
4. Check-in feedback: transparent deterministic recommendation from actual answers; optional relevant destination; no diagnosis or streak pressure.
5. Safety Wallet: essential offline access, explicitly selected preview/share/print, private by default, truthful no-emergency-monitoring copy.
6. Membership: practical benefits, actual StoreKit-localized price where available, separately charged services disclosed, crisis separated from sales.
7. Reminders: optional permission requested only after user action, discreet content, chosen time/type, pause/remove, account-safe notification cleanup.

## Baseline and environment evidence

- Starting source: `89da94e48fd7a612b733b03e36b7c178bb113485`, matching GitHub main.
- Baseline: 169 TypeScript + 67 JavaScript tests passed; Expo Doctor 18/18; dependency audit passed existing documented advisory policy.
- Fresh disposable local database replay and suite: 17 files / 354 assertions passed. No production reset.
- App Store Connect read access verified using EAS-managed credentials. Existing live build is 3.7 (11); 3.8 (2) was absent before work.
- EAS remote iOS build counter explicitly set to 2 and read back as 2.
- Read-only backend preflight confirms September audit migrations and revised functions remain undeployed. The seven new features are device-local/client-only and introduce no new server contract. Keep production rollout held and report this separately; do not claim the binary deploys backend security fixes.

## Gates

- Reuse existing storage and routes; no invented backend or unreviewed paid-access change.
- Independent spec review followed by quality/security review; all confirmed blockers repaired.
- Parent reruns typecheck, complete tests, native/web exports and browser feature interactions.
- Inspect backend dependency status before release. No production destructive tests or resets.
- GitHub main verified at exact reviewed commit. Explicit deployment hold retained unless backend rollout is necessary and validated.
- EAS remote counter inspected: observed 1 before implementation. Target exactly version 3.8/build 2; inspect finished IPA metadata and source commit.
- Submit exact verified build ID, read back submission and Apple processing status. EAS finished is not Apple accepted or TestFlight processed.
- Physical notification, camera/microphone and purchase checks must not be represented as device-tested without actual device execution.


## Integrated release gate

- All seven improvements completed; scoped spec/quality and final integration reviews passed.
- Full client suites: 210 TypeScript and 79 JavaScript tests, zero failures; typecheck passed.
- Fresh-cache Expo iOS, Android and web exports passed. Static exported web tested against isolated Supabase: 20/20 checks, zero page errors, 320px/390px layout checks.
- Reminder cleanup is awaited before logout/deletion; legacy daily nudges require explicit separate consent.
- Crisis Mode and Safety Wallet both use explicit selective preview/export; web clear confirmation verified.
- EAS remote counter re-read as 2; exact release profile disables auto-increment.
- Production web/Supabase deployment hold remains intentional. Native physical-device tests and live sandbox purchase tests are not claimed.
- Browser QA must serve a fresh --clear export: CI Metro and Metro transform caches can retain stale code or a prior loopback environment.
