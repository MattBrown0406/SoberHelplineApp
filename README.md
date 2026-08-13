# Sober Helpline App

Family support companion for addiction recovery — the Expo / React Native app for families using [SoberHelpline.com](https://soberhelpline.com). This repository is **not** the website.

**Hope. Help. Recovery.**

Native version **3.7** (iOS `buildNumber` 1 / Android `versionCode` 1).

## What ships

Expo Router tabs: **Today**, **Practice/Scripts**, **Boundaries**, **Tracker**, **Learn**, **Support**.

Sober Helpline is free crisis triage and family support — never a paid treatment-placement funnel. The finder stays alphabetical and navigator-mediated, with no sponsored ranking. Crisis (911 / 988 / Crisis Copilot) stays above any paid coaching door.

Family-behavior tools on the free (`direct-free`) tier:

- Castle walls, enabling quiz, tracker, in-app Learn FAQ and resources
- Family Space: propose a wall, persist “I’m wavering,” shared “what we will say” script, hold-log (we held the wall)

Coach messaging and live video stay paid.

## Repository contents

| Path | What it is |
|---|---|
| `app/` | Expo Router screens (tabs + crisis, finder, rehearsal, letter) |
| `src/` | Hooks, i18n (en/es), content, UI |
| `supabase/migrations/` | Schema. Apply via the usual Supabase workflow — **do not apply to production from a PR agent** |
| `docs/` | Product decisions, legal drafts, feature specs |

## Product model (one paragraph)

One app binary, two account states. **Attached** families get an assigned coach, provider-scheduled sessions, and zero in-app commerce. **Direct** App Store families get free family-behavior tools plus optional IAP (Essential: coach messaging; Premier: live video). Crisis lines are never gated. The public finder is A–Z and navigator-mediated — not a placement marketplace.

## Related repositories

- [`soberhelpline`](https://github.com/MattBrown0406/soberhelpline) — website, provider dashboard, coach admin.

## Status

Shipped Expo app. TestFlight / device testing happens after a native version bump; App Store review is a separate step.
