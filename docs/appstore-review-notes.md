# App Store Review Notes

Paste the "REVIEW NOTES" block below into App Store Connect → version → App Review
Information → Notes. Also confirm the demo-account and contact fields in that same section.

> ⚠️ Before submitting, verify the direct reviewer account in production and test the exact selected build on iPad.

---

## REVIEW NOTES (paste this)

Thank you for reviewing Sober Helpline.

WHAT'S NEW IN 3.5.1
This maintenance update fixes a daily check-in race that could show a save error
when that day's check-in already existed in the account. Duplicate submissions
now resolve to the existing authoritative record, and the app no longer displays
a completed check-in before the authenticated cloud save succeeds.

WHAT THE APP IS
Sober Helpline supports the families and loved ones of people struggling with
drug or alcohol addiction — with daily check-ins, boundary-setting tools,
educational content, conversation scripts, peer support groups, and access to
coaches. It is a coaching, education, and peer-support product. It is NOT medical
care, therapy, diagnosis, or a treatment service, and it makes no such claims.

SIGN-IN IS REQUIRED — DEMO ACCOUNT
The app requires an account. Please use this demo login:

   Email: appreview@soberhelpline.com
   Password: APPREVIEW

This is a direct/free App Store review account. It can access the core family-support experience and the subscription purchase surfaces; paid-only features remain locked until a sandbox purchase is completed.

After tapping "Sign In," the app immediately shows "Signing you in…" while it loads the account, then opens onboarding or the Today tab. Optional subscription-provider checks run in the background and do not block entry.

PROVIDER-CONNECTED ACCOUNTS
Some families receive Sober Helpline through an invited provider organization and see that provider's branding and assigned care team. This is an invitation-only account type. The direct demo account above covers the complete consumer review path and does not require access to a reviewer-controlled email inbox.

IN-APP PURCHASES
Optional auto-renewable subscriptions (Essential, Premier) are sold via Apple
in-app purchase. Essential unlocks private support messaging. Premier adds the
in-app plan-review and private-video benefits described on the purchase screen.

1:1 COACHING SERVICES (Guideline 3.1.3(d))
The standard "Book 1:1 coaching" screen submits a scheduling request for a
real-time, person-to-person coaching session. It does not collect payment or open
an external checkout inside the app. Staff follows up with the requester to
arrange that individual service.

Essential members can also request a separate $150, 60-minute, real-time plan
review with a coach. After the appointment request is created, that screen may
open an external PayPal checkout for this person-to-person service. Payment is
for the live one-to-one coaching appointment—not app features, digital content,
or a group service. Premier members receive the same live plan-review appointment
as part of their Apple-billed subscription and are not sent to external checkout.
All subscription-based digital features use Apple in-app purchase.

CRISIS / SAFETY
The app surfaces 911 and 988 (Suicide & Crisis Lifeline) prominently and never
places crisis access behind a paywall. The app is not an emergency service; this
is stated in-app and in the description.

PROVIDER / WHITE-LABEL
Some accounts are connected to an invited provider organization. Those families access services through their provider and see that provider's branding. The direct demo account above is intentionally not provider-connected.

LIVE GROUPS / CAMERA & MIC
Hosts may broadcast video in live support groups (camera/mic used only when a
host chooses to go live, or during a 1:1 coaching call). Attendees are view-only.
Permission strings explain this.

ACCOUNT DELETION
Users can delete their account and all associated data in-app:
Support tab → Settings (gear icon) → Delete account.

PRIVACY
Privacy Policy: https://soberhelpline.com/privacy
Terms of Service: https://soberhelpline.com/app-terms
Sensitive entries (check-ins, letters, messages) are private to the user and,
where applicable, their assigned coach; never sold or used for advertising.

CONTACT FOR REVIEW QUESTIONS
Matt Brown · matt@soberhelpline.com · 503-836-2136

---

## Pre-submission checklist (do these before hitting Submit)

- [ ] Verified the direct App Review account signs in on the production backend and in the exact selected iPad build.
- [ ] Privacy Policy + Terms URLs are LIVE and reachable (App Review will click them).
- [ ] Paid Applications Agreement is Active in App Store Connect → Business.
- [ ] Both subscriptions show "Ready to Submit" (metadata, price, review screenshot each).
- [ ] App Privacy "nutrition label" completed (data types, linkage, tracking = none).
- [ ] Age rating questionnaire completed (likely 17+ given mature subject matter — answer honestly re: medical/drug references).
- [ ] Support URL + marketing URL set.
- [ ] Confirmed the standard 1:1 request flow has no checkout and the separate $150 plan-review checkout is only for a real-time person-to-person service, exactly as disclosed in the review notes.
- [ ] Build uploaded via EAS/Xcode and selected for this version.
- [ ] Screenshots uploaded (iPhone 6.5"/6.7"; iPad if iPad enabled).

## Likely rejection risks for THIS app (worth pre-empting)
1. Login wall with no/invalid demo account → the #1 cause. Triple-check the logins.
2. 1:1 coaching request misunderstood as digital payment → the accurate 3.1.3(d) paragraph above explains that no checkout occurs in-app.
3. Health/medical claims → keep all copy as "support/education/coaching," never "treat/cure."
4. Account deletion missing → it exists; the notes tell the reviewer exactly where.
5. Broken privacy/terms links → must be live before submit.
6. Crisis content without disclaimer → 911/988 + "not an emergency service" present.
