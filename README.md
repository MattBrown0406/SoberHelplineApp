# Sober Helpline App

Family support companion for addiction recovery — the mobile app for [SoberHelpline.com](https://soberhelpline.com).

**Hope. Help. Recovery.**

The intervention is a moment; the family's recovery is a journey. Sober Helpline guides families through it: daily check-ins, boundary-building anchored in the castle framework, warning-sign *and* recovery-sign tracking, conversation scripts, and crisis access to live coaches.

## Repository contents

| Path | What it is |
|---|---|
| `design/sober-helpline-app.html` | Interactive prototype of the family-facing mobile app (open in any browser). Includes a demo toggle for **attached** (provider org) vs **direct** (App Store) account states. |
| `design/sober-helpline-provider-console.html` | Provider org console mockup — meetings/groups, coach assignment, white-label branding, tiered subscription. Reference spec: these features ship inside the SoberHelpline.com provider account, not as a separate product. |
| `design/sober-helpline-super-admin.html` | Platform owner console mockup — crisis coach network (availability + on-call routing), direct members, provider orgs, tiered org billing. Reference spec: ships inside the existing SoberHelpline.com admin dashboard. |
| `docs/product-decisions.md` | Access model, monetization lanes, and App Store compliance strategy. |

## Product model (one paragraph)

One app binary, two account states. **Attached** families get an assigned coach, provider-scheduled sessions, and zero in-app commerce (the provider org pays; providers bill families directly). **Direct** App Store families get tiered IAP plans — Essential (message the on-call coach) and Premium (live calls during coach business hours) — backed by the platform's hand-picked crisis coach network. Provider orgs pay a monthly tier based on families supervised and can white-label the app (logo, name, colors) delivered per-account at login.

## Related repositories

- [`soberhelpline`](https://github.com/MattBrown0406/soberhelpline) — website, provider dashboard, coach admin, and the API this app consumes.

## Status

Design/prototype stage. Next steps: pick the mobile stack (React Native or Flutter), define the API contract (entitlements, branding payload, on-call roster, sessions feed), and build the check-in + boundaries vertical slice first.
