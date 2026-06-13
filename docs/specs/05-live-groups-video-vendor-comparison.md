# Feature Spec 05 — Live Groups + Video Vendor Comparison

**Status:** Decision doc · pick a vendor before building · June 2026
Goal: host-on-camera live groups (TikTok-Live style) inside Sober Helpline —
host broadcasts, attendees watch + submit questions via chat, host can remove
anyone. One platform account across all white-label providers (no per-provider
Zoom accounts). The video vendor is invisible plumbing; the experience is ours.

## The usage we're pricing against

Baseline (launch): **1 group/week · 15 participants · 60 min ≈ 3,900 participant-minutes/month.**
Growth (4 active weekly groups, 25 ppl): **~26,000 participant-minutes/month.**

Billing across all vendors is per *participant*-minute (5 people × 10 min = 50 min).

## The three options

### Zoom Build Platform (Video SDK)
- **Rate:** $0.0035/participant-min · recording +$0.01/min · transcription +$0.01/min.
- **Sold as credits:** $100 = 100 credits = ~28,571 min. Intro: "Try 20 credits free" (~5,700 min, one-time).
- **Launch cost:** ~$13.65/min-value — BUT entry plan has a **$100/month floor** unless
  credits roll over or pay-as-you-go is enabled (UNCONFIRMED — must verify in console/sales).
- **Self-host:** No.
- **Note:** NOT the "Zoom Developer Pack" (that's QSS/RTMS — irrelevant here).

### Daily (daily.co)
- **Free tier:** **10,000 participant-min/month, recurring, no card required.**
- **Rate after free tier:** pay-as-you-go (~$0.004/min historically — verify current).
- **Launch cost:** **$0/month** (3,900 < 10,000 free).
- **Self-host:** No, but simplest/fastest integration; prebuilt React Native components + chat.

### LiveKit (livekit.com) — open source
- **Free "Build" tier:** **5,000 WebRTC min/month + 50 GB egress, permanent, no card.**
- **Paid:** Ship $50/mo, Scale $500/mo. Usage connection fee from **$0.0005/min** (notably cheaper at scale).
- **Launch cost:** **$0/month** (3,900 < 5,000 free).
- **Self-host:** **YES — open-source server.** Run it on your own infrastructure later and
  pay only for servers, zero per-minute fees. The closest thing to "own it yourself"
  without building video from scratch.

## Cost at our volumes

| | Launch (~3,900 min) | Growth (~26,000 min) | Self-host path | Free tier |
|---|---|---|---|---|
| **Zoom Video SDK** | $100/mo floor* | ~$100/mo (91 credits) | No | 20 credits once |
| **Daily** | **$0** | ~$64/mo over free | No | 10,000 min/mo |
| **LiveKit Cloud** | **$0** | ~$10–50/mo | **Yes** | 5,000 min/mo |

\* unless rollover/PAYG confirmed, in which case ~$14/mo.

## Recommendation

**LiveKit** is the best fit, for reasons that match Matt's stated instincts:
1. **$0 at launch** (free tier covers baseline) — no monthly floor to justify before families show up.
2. **Cheapest as we grow** (connection-minute model).
3. **Open-source self-host path** — directly answers "why depend on an outside vendor?"
   Start on their cloud free tier; if groups become core, move to our own servers and
   eliminate per-minute fees entirely. We're never locked in.
4. **Strongest white-label story** — one account (or our own servers), our branding,
   providers never touch a video vendor.

**Daily** is the pragmatic runner-up: same $0 launch cost, even more generous free tier,
fastest to integrate (best prebuilt components) — but no self-host path, so we'd stay a
tenant forever.

**Zoom Video SDK** is the weakest fit *for this feature* despite being our existing vendor:
the $100/month credit floor (pending rollover confirmation) makes it the most expensive at
launch volume, and there's no self-host option. Keep Zoom for what it's already doing
(Monday-night meetings via the existing account + the zoom-sync function); use a purpose-built
video SDK for the in-app live groups.

## What the feature needs (vendor-agnostic)

- **Host broadcast:** one publisher (camera + mic), many view-only subscribers.
- **Question chat:** text channel; attendees post, host + co-hosts see a queue.
- **Moderation:** host can mute/remove a participant; removal blocks rejoin for the session.
- **Identity/anonymity:** attendees join by first name only; no attendee video.
- **Entitlement:** open to all members (attached + direct), per current group rules.
- **Branding:** room UI themed from the org branding payload (white-label).
- **Tokens:** room access tokens minted server-side (Supabase edge function) from the
  vendor's API key/secret — never in the app.
- **Recording (optional, later):** vendor-side recording → store link on the session row.

## Open questions before building

1. Confirm whether Zoom Build Platform credits roll over / PAYG exists (only matters if
   we reconsider Zoom).
2. LiveKit Cloud vs. self-host for v1 — recommend **Cloud free tier first**, self-host
   when volume or white-label demand justifies the ops work.
3. Recording: needed at launch, or fast-follow? (Affects vendor egress/storage costs.)
4. Moderation policy doc + per-group human host (operational, parallel to the build).
