# Sober Helpline 3.8 (2) — TestFlight notes

## What changed

1. Optional situation-based start: choose what is happening, skip setup, or access urgent help immediately.
2. Private boundary follow-through: save what you will communicate, your own action, a review date, and a compassionate follow-up response.
3. Guided next steps: move through understanding, boundaries, practice, and support at your pace; resume saved progress.
4. Useful check-in feedback: one optional, rule-based next action based on your saved answers, without diagnoses or streak pressure.
5. Offline Safety Wallet reading with explicit field selection, exact preview, sharing and printing. Crisis Mode uses the same selection controls. Editing or clearing source data resets an open preview.
6. Clearer membership benefits, separately charged services, and actual store-provided subscription prices; unavailable prices cannot initiate purchase.
7. Optional personal reminders for boundaries, support meetings, learning and coaching preparation. Choose a daily local time, pause or remove. Notification text is discreet and never contains personal notes. Daily check-in reminders require their own explicit opt-in.

## Privacy and scope

New situation/progress, boundary follow-through and reminder preferences are saved per account on this device, not application cloud-synced. Saved Safety Wallet access depends on retained account information. The app is not monitored for emergencies. OS share sheets, printers and recipients are outside the app's control. No new backend schema is required by these seven features.

This TestFlight release does not publish a public App Store version, push an OTA, apply pending production database migrations or deploy backend functions. The earlier September backend audit fixes remain a separate rollout.

## Test on device

- Complete and skip situation setup; verify urgent phone actions during setup.
- Save journey progress, close/reopen, switch accounts, and verify isolation.
- Save/review a boundary and verify failed saves retain text.
- Save wallet details; reopen offline, select one field, preview, then use native Share and Print. Verify unselected information is absent.
- Enable, pause and remove a personal reminder. Check permission denial, app foregrounding, actual notification delivery, timezone changes, and logout cleanup.
- Verify real StoreKit-localized prices, purchase and Restore Purchases using authorized tester accounts.

Automated and browser checks cannot establish actual device notification delivery, phone calls, printing, StoreKit transactions, camera or microphone behavior.
