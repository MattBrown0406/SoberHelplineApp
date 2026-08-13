# Family Curriculum — phase-keyed teaching content on Today

_Spec + implementation notes. Batch 1 of 52 weeks (weeks 1–8) shipped for voice review._

## Problem

The Today feed rotates its focus content with day-of-year modulo:

```ts
setQuoteIndex(doy % QUOTE_COUNT);      // 14
setFocusSlot(doy % FOCUS_POOL_COUNT);  // 7
setScriptSlot(doy % 14);
```

That design earns the daily check-in habit, which is the app's core win and is
not being changed. But it has no progression: a family on day 200 sees the same
focus card they saw on day 60. There is no arc, so there is nothing that
compounds and nothing that distinguishes week 30 from week 3.

Separately, the teaching material ("60+ exercises and assessments") lives on the
website and is reached from `learn.tsx` via an SSO round-trip. The app has no
authored teaching content of its own.

## Approach

Add an **advancing weekly teaching arc** on top of the existing daily loop.
Content-as-data, matching the `src/content/scripts.ts` convention exactly:
parallel English and Spanish libraries sharing ids, weeks, phases, and colors.

Nothing about the daily rotation changes. The curriculum is additive.

### Why weeks-since-join, not level of care

Phase is derived from the family's own clock. This is a deliberate departure
from how FamilyBridge models phase (`care_phases`: detox → residential → PHP →
IOP → outpatient → sober living → independent), which tracks the *loved one's*
clinical placement.

Two families in week 3 need the same thing — a boundary that holds on a Tuesday
— whether their loved one is still using or 60 days into residential. The
family's recovery runs on its own timeline and is not contingent on the client's.
That is the doctrine the curriculum teaches, so the data model should reflect it.

### Phases

| Phase | Weeks | Thesis |
|---|---|---|
| `orientation` | 1–2 | Stop the bleeding. You're not crazy and not alone. |
| `stabilizing` | 3–5 | Boundaries as protection, not punishment. |
| `family_recovery` | 6–8 | The pivot: your recovery is not contingent on theirs. |
| `durability` | 9+ | What holds after the crisis lifts. _(reserved — batch 2)_ |

### Piece shape

Each piece is three moves, deliberately small:

- **mechanism** — why this is happening. Named and normalized, mechanism-first,
  never shamed. This is the part that does the clinical work.
- **practice** — one concrete thing this week. Small enough to actually do.
- **prompt** — one question worth sitting with. Not homework.

Plus `crisisSafe: boolean` — see safety below.

## Safety: band gating

`selectCurriculumPiece(week, band, language)` will only return pieces marked
`crisisSafe` when the situation band is `elevated` or `crisis`.

A family whose week is on fire should not be handed a reflection exercise. Week
5 ("one limit you keep beats ten you announce") is authored `crisisSafe: false`
for exactly this reason — it asks for discipline from someone who may have none
left this week. An elevated family falls back to the nearest safe piece; if
nothing is eligible the selector returns `null` and Today renders no card, so
the support-forward surfaces (`SituationCard`, `NeedsRouter`) carry the screen.

Bands come from the `my_situation()` RPC via `useTodayFeed`. All four bands
(`calm`, `watch`, `elevated`, `crisis`) are handled; only the upper two gate.

## Partial-library behaviour

Only weeks 1–8 are authored. `selectCurriculumPiece` **holds at the highest
eligible authored week** rather than returning null, so a family in week 20 sees
week 8 instead of an empty card. `isBeyondAuthoredCurriculum(week)` exposes the
backlog signal for a future admin view.

This is what makes shipping 8 of 52 safe.

## Files

| File | Change |
|---|---|
| `src/content/curriculum.ts` | **new** — 8 pieces × 2 languages, phase model, selection |
| `src/api/types.ts` | `CurriculumPiece`, `CurriculumPhase`, `SituationBandInput` |
| `src/components/today/CurriculumCard.tsx` | **new** — collapsed-by-default card |
| `src/hooks/useTodayFeed.ts` | adds `curriculumWeek`, `curriculumPhase`, `beyondCurriculum` |
| `app/(tabs)/index.tsx` | renders `CurriculumCard` above `FocusCard` |
| `src/locales/{en,es}/today.json` | `curriculum.*` chrome keys |
| `tests/curriculum.test.ts` | **new** — 19 tests |

### ⚠️ One manual step: register the test in CI

`.github/workflows/quality.yml` enumerates test scripts explicitly, so
`test:curriculum` **will not run in CI until this line is added** after
`- run: npm run test:push`:

```yaml
      - run: npm run test:curriculum
```

This was intentionally left out of the branch: pushing workflow changes requires
a PAT with `workflow` scope, which the automation token deliberately does not
have. Add it via the GitHub web editor on the PR branch, or locally with a
`workflow`-scoped token.

## Shipping

**JS-only. No migrations, no edge-function changes, no schema touches** — this
batch ships over the air via EAS OTA and needs no store review.

Verify the OTA channel actually reaches the device before reporting it live; a
channel-less build has silently ignored OTA updates on this project before.

## Test coverage

`npm run test:curriculum` — 19 tests, all passing. Notable cases:

- **week never wraps** — asserts the week is non-decreasing across 400 days.
  This is the regression the feature exists to fix; the old modulo rotation
  would fail it.
- **crisis-safe gating** — sweeps weeks 1–12 × {elevated, crisis} and asserts no
  unsafe piece ever leaks.
- **locale parity** — ids/weeks/phases/flags/colors identical across libraries,
  and prose asserted *different* (catches copy-through instead of translation).
- **phase bounds contiguous** — no week can fall between two phases.

Also verified: `npm run typecheck` clean, and `test:auth` / `test:checkin` /
`test:push` unchanged (10 / 8 / 6 passing).

## Open items for batch 2

1. **Write weeks 9–52.** Gated on voice review of this batch.
2. **Notification copy.** `daily-nudge` currently sends a generic check-in
   nudge. Once the arc is trusted, a weekly piece-aware push ("Week 6 is up")
   is a natural addition — it needs no new infrastructure, only copy and a
   `data.screen` value.
3. **Engagement signal.** Nothing records whether a piece was expanded. A
   `curriculum_views` table would enable the silence detection that catches
   families who quietly disengage before renewal.
4. **Migrate in-app.** Long-term, the website's 60+ exercises could move into
   this library and retire the `learn.tsx` SSO round-trip.
5. **Admin preview.** `getCurriculum()` returns the full library; a super-admin
   screen could preview any week without waiting for the clock.
