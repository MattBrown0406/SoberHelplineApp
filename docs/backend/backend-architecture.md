# Sober Helpline — Backend Architecture

**Status:** Build spec for Claude Code · v1 · June 2026
Read alongside `docs/product-decisions.md` and `src/api/types.ts`.

## Stack recommendation

**Supabase** (Postgres + Auth + Realtime + Edge Functions + Storage) as the core platform.

Why for this product specifically: built-in auth with row-level security (the privacy model below maps directly to RLS policies — check-ins readable by owner + assigned coach only, enforced at the database, not in app code); Realtime channels give coach chat and alignment updates without running a websocket fleet; Postgres handles the relational shape (orgs → staff → families → members); Edge Functions host the webhook endpoints (RevenueCat, Stripe, Twilio). One platform a solo-founder team can operate. The SoberHelpline.com website talks to the same database for the provider dashboard and super admin views.

Supporting services:
| Concern | Service | Notes |
|---|---|---|
| IAP subscriptions | **RevenueCat** | Entitlements source of truth for member tiers; webhooks → `entitlements` table |
| Org billing (B2B tiers) | **Stripe Billing** | Starter/Growth/Scale subscriptions, invoices, 30-day cap-overage notices |
| Crisis voice calls | **Twilio Programmable Voice** | On-call ring → 60s cascade; masked numbers (coaches' personal numbers never exposed) |
| Video sessions & groups | **Zoom** (Meeting SDK / API) | Already the home of Monday night groups; API creates sessions, app deep-links in |
| Push notifications | **Expo Push** (start) → APNs/FCM direct if needed | Notification copy is content, lives in locale files |
| Email | Postmark or Resend | Transactional only (invites, receipts, letter export) |

## Core data model (extends src/api/types.ts)

```
orgs                 id, name, tier, stripe_customer_id, branding(jsonb: logo_url, name, primary, accent), status
staff                id, org_id?, user_id, display_name, role(admin|coach), credential, license_verified(bool),
                     crisis_network(bool), available(bool), on_call(bool), business_hours(jsonb), language[]
accounts             id, user_id, type(attached|direct), org_id?, language, tz, created_at
family_spaces        id, name, org_id?, invite_code
family_members       family_id, account_id, role(owner|member)
checkins             id, account_id, mood(1-5), note?, created_at          -- RLS: owner + assigned coach
tracker_logs         id, account_id, sign_key, kind(warning|recovery), week, created_at
walls                id, account_id, text, anchor(enabling|harm|both), created_at
shared_walls         id, family_id, text, proposed_by, anchor?
wall_commitments     shared_wall_id, account_id, status(committed|wavering|none), updated_at
wavering_events      id, shared_wall_id, account_id, shared_with_family, coach_pinged, created_at
letters              id, account_id, p1/p2/p3(jsonb), status, shared_with_coach   -- encrypted at rest, no analytics
rehearsals           id, account_id, source(jsonb), mode, pressure_style?, created_at  -- counts only, no media
messages             id, thread_id, sender(account|staff), body, created_at   -- Realtime channel per thread
threads              id, account_id, staff_id?, kind(assigned|oncall)
sessions             id, org_id?, kind(group|coaching|counseling), title, schedule(jsonb), zoom_meeting_id, visibility
session_rsvps        session_id, account_id, status
alerts               id, account_id, kind(warning_threshold|streak_break|recovery_momentum), payload, state, assigned_staff_id
crisis_calls         id, account_id, routed_staff_id, channel(phone|video), started_at, ended_at, outcome
wins                 id, account_id, body, state(pending|approved|rejected), reviewed_by, locale
entitlements         account_id, source(revenuecat|stripe|org|scholarship), tier(essential|premium|org), expires_at, raw(jsonb)
lessons              id, slug, locale, title, body_md, media_url, path_id, position    -- Matt's content libraries
scripts              id, slug, locale, category, title, say, avoid, why               -- ships from CMS table, not app builds
audit_log            actor, action, subject, at                                        -- esp. staff access to member data
```

## Services & key flows

**Entitlement resolution (the access-state engine).** One function answers "what can this account do?": org-attached → org tier features, zero commerce; direct → RevenueCat entitlement (essential/premium); scholarship → flag on entitlements. The app fetches this at login and on foreground; everything in the UI gates off it. Never trust the client.

**Crisis routing.** Tap → Edge Function checks account type: attached → org's on-call staff; direct → platform crisis network on-call. Twilio rings on-call coach (masked); no answer in 60s → parallel cascade to all `available=true` network coaches; nobody in 120s → in-app fallback screen with 988/911 messaging + on-call message thread. Every call logged to `crisis_calls`; gaps in coverage trigger super-admin alerts (cron checks the on-call calendar).

**Alerts engine.** Nightly + on-write triggers: ≥3 warning signs/wk → alert to assigned coach; checkin gap ≥7 days → disengagement alert; ≥3 recovery signs → momentum alert (coach nudge to encourage). All alert thresholds in a config table so you can tune without deploys.

**White-label.** `orgs.branding` jsonb returned in the login payload; app themes at runtime. Super admin approves branding before it goes live (state machine: draft → submitted → approved).

**Moderation.** Wins land `pending`; coach/admin queue in the website dashboard; approved wins fan out to locale-matched feeds.

**Messaging.** Supabase Realtime channel per thread; RLS so only the member + assigned (or on-call) staff can read. Retention policy: configurable, default 24 months.

## Payments — the RevenueCat decision

**Yes: RevenueCat is the right call.** Confirmed current pricing: free up to $2,500/mo tracked revenue, then 1% of gross MTR — meaning it costs nothing until the consumer side has real traction, and 1% is far cheaper than building receipt validation, renewal webhooks, refund handling, and entitlement state yourself. What it does for us: StoreKit2/Google Billing abstraction (one SDK in React Native), server-side receipt validation, the `entitlements` webhook feed, and — important for phase 2 — **Stripe as a store**, so when the web billing portal launches, web subscribers and IAP subscribers resolve through the same entitlement system. The alternative (raw StoreKit 2 + App Store Server API) is free but is several weeks of subtle engineering with real money bugs; not worth it at this stage.

Boundary: RevenueCat handles **member** subscriptions only. **Org tiers bill through Stripe directly** (B2B invoicing, seat caps, the 30-day overage notice) — never through the app, keeping the attached experience commerce-free.

## Security & privacy posture

- RLS on every table; staff access only via assignment; all staff reads of member data hit `audit_log`.
- Letters and check-in notes: application-layer encryption on top of disk encryption; excluded from analytics and any model training.
- Positioning: **wellness/coaching product, not a covered entity** — no medical records, no diagnosis, no insurance billing. If a provider org wants to feed data into clinical records, that's their HIPAA obligation; we offer a BAA conversation only when/if enterprise demand requires it (Scale tier, later).
- Account deletion: in-app, cascades hard-delete of member content within 30 days; crisis call metadata retained (de-identified) per protocol doc.
- Data residency: US region.

## Build phases

1. **P0 (TestFlight blocker):** Auth + accounts + org invite redemption · check-ins · walls/tracker · entitlement resolution (org + RevenueCat sandbox) · settings with account deletion · push for daily nudge.
2. **P1:** Coach messaging (Realtime) · sessions/RSVP (Zoom API) · alerts engine · provider dashboard endpoints for the website.
3. **P2:** Crisis routing (Twilio) · family spaces/alignment · moderation queue · white-label payload.
4. **P3:** Letter builder sync · weekly review generation · Stripe org billing automation · web billing portal (RevenueCat+Stripe).
```
