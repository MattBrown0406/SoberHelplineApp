# Product Decisions

Living record of the decisions behind the Sober Helpline app. Last updated June 2026.

## Account states

**Attached (provider org).** Family is supervised by a provider organization (e.g., Freedom Interventions). They see: assigned coach (and counselor if licensed staff), messaging with their coach, provider-scheduled groups and 1:1 sessions, and crisis calls routed to the on-call coach **set by the provider admin**. No payment UI anywhere — membership shows as "Covered — included through {provider}." Providers bill families directly at their own rates (including after-hours calls); those rates never appear in the app.

**Direct (App Store, no org).** No assigned coach — that UI does not exist for them. Crisis access routes to the **platform crisis network** controlled by the super admin: on-call coach answers by default; members can pick any coach showing available. Tiers:

- **Essential** ($19/mo, IAP): messaging with the on-call coach, full app, groups.
- **Premium** ($49/mo): live phone/video with a coach during the coach's local business hours.
- **After-hours calls**: add-on, pricing TBD.

Direct members also see a "Find a provider" referral card — the consumer app feeds the B2B pipeline.

## Coach terminology

"Coach" by default. "Counselor" label appears **only** when a verified clinical license (LPC, LCSW, LMFT, PhD, etc.) is on file. Enforced automatically by credential records, not chosen by the org.

## Crisis routing

Crisis tap rings the on-call coach first; if unanswered in 60 seconds, cascades to all available coaches. Coaches flip their own availability; the admin (super admin for the platform network, provider admin for org staff) controls network membership and on-call assignment. Coverage gaps trigger admin alerts. 911/988 is always displayed in the crisis sheet.

## White-label

One app binary (avoids App Store guideline 4.3 spam rejections). Org admins upload logo, name, and two brand colors in their provider account on SoberHelpline.com; super admin approves once; branding is delivered per-account at login to every family under that org.

## Provider org billing

Monthly subscription tiered by families supervised (launch pricing): Starter $149 (≤10 families), Growth $449 (≤50, white-label), Scale $949 (unlimited, API/EHR export). Crossing a cap gives the org admin 30 days' notice before the next tier bills.

## App Store compliance strategy

1. **Attached accounts contain zero commerce** — nothing for IAP rules to object to. Entitlements only.
2. **Direct Essential tier** is a digital subscription → must be IAP.
3. **Direct Premium 1:1 live calls** qualify for the person-to-person services exemption (guideline 3.1.3(d)) — may be billed outside IAP (e.g., Stripe). Group sessions do **not** qualify (one-to-many must be IAP).
4. **US storefront** may include external payment links post-Epic injunction (May 2025).
5. Position as **coaching/peer support, not treatment** — no diagnostic or medical-care claims.
6. Privacy (5.1.1): explicit consent for sharing check-ins/logs with coaches, no data sale, in-app account deletion.
7. Provide App Review with demo logins for all three states: direct free, direct premium, org-attached.

## Open questions

- After-hours call pricing/mechanics for direct members (consumable IAP vs person-to-person external billing).
- Whether attached families' crisis taps fall back to the platform network after provider hours (potential Growth-tier selling point).
- Hybrid crisis monetization: first crisis session free for non-subscribers, then convert.
