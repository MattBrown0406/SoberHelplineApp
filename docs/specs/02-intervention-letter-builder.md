# Feature Spec 02 — Intervention Letter Builder

**Status:** Approved for build · Structure is FINAL — taken directly from Freedom
Interventions' "Intervention Letter Guidelines" (Matt Brown's actual family handout).
Do not invent additional sections.

## Problem

Before an intervention, family members must say what addiction has done to their
relationship — in a way that can be heard and remembered. Unguided, they write
accusations, ultimatums, or multi-page essays of pain. Matt's handout solves this with a
strict three-paragraph, one-page structure; this feature turns that handout into a guided
builder.

## Governing principles (from the handout — these drive UX decisions)

1. **One side of a single page. Brevity is critical.** Emotional intensity and stress
   reduce attention and retention; a concise message is more likely to be absorbed.
   The builder must actively enforce brevity, not just suggest it.
2. **Exactly three paragraphs**, each with a distinct purpose. The structure is
   standardized; the content is the writer's lived experience.
3. **Rooted in care — never punishment, blame, or shame.**

## Letter structure (data-driven; ships as JSON in en + es)

### Paragraph 1 — Why You Are Here
- Express love; state that participation in the intervention is motivated by that love.
- Name specific qualities valued in the loved one (kindness, humor, loyalty, creativity,
  compassion) — "even if those qualities feel diminished right now."
- Optional: one brief memory of them at their best or of the relationship at its
  strongest.
- Builder prompts: "What do you love about them that addiction hasn't erased?" /
  "One moment that shows who they really are."
- Coach note shown in UI: *"This paragraph exists so they know this meeting is care and
  concern — not punishment, blame, or shame."*

### Paragraph 2 — How This Has Affected You
- Opens with the handout's starter sentence (pre-filled, editable):
  *"Your substance use has affected me in the following ways."* (label editable —
  "your drinking," "your behavior" — the impact matters more than the label).
- **Two or three** specific experiences, focused on how the writer FELT — not
  diagnosing, criticizing, or cataloging behaviors. Builder caps this at 3 experience
  blocks by design.
- I-statement scaffolding (from the handout, shown as fill-in patterns):
  - "When you lied to me about ___, I felt ___."
  - "When you drove while impaired, you could've hurt yourself or someone else, and
    I felt scared."
  - "When I see how this is affecting our family, I feel helpless and heartbroken."
- Coach note: *"The emotional impact you describe exists because of your love and
  investment in the relationship."*

### Paragraph 3 — The Request and the Boundary
- **The request:** clear and direct — choose to accept help **today**. Pre-filled
  starter: *"I want you to choose to go to treatment today."* UI states plainly:
  this is not an invitation to negotiate alternatives.
- What the writer hopes the relationship can become if they accept help; how the writer
  will support them in healthy, **non-enabling** ways.
- **The boundary:** what will change if they choose not to get help. Boundaries must be
  anchored in one or both of the two questions (same anchors as the Boundaries tab):
  1. Am I currently enabling the addiction?
  2. Am I being harmed by the addiction emotionally, financially, or physically?
  → Builder imports the writer's saved, anchored walls from the Boundaries tab here.
- **Credibility check (required tap-through):** "Only include boundaries you are
  genuinely prepared to follow through on." Writer confirms per boundary:
  "I will follow through on this." Unconfirmed boundaries don't go in the letter.
- **The close:** reaffirm love, then ask directly whether they see that help is needed
  and are willing to accept it. (Pre-filled closing question, editable.)

## Brevity enforcement (core UX, per principle 1)

- Live **one-page meter** (not a word counter): renders draft at export type size and
  shows fill of a single page. Green to ~85%, amber to 100%, red overflow blocks export
  with: "Your letter must fit on one side of a single page. In the room, shorter is
  stronger."
- Paragraph 2 limited to 3 experience blocks; no "add paragraph" anywhere.
- Estimated read-aloud time displayed (~2 minutes at full page).

## Tone flags (highlight, never block)

Wordlist + patterns, en + es: "you always," "you never," "after everything," "how could
you," profanity, ALL-CAPS runs; es: "tú siempre," "tú nunca," "después de todo lo que
hemos hecho por ti." Suggestion chip: "Try one specific moment and how it made you feel."

## Workflow & sharing

- Save/resume drafts; one letter per family member (Family Space shows completion
  status only — contents stay private to each writer + coach).
- **Send to your interventionist:** attached accounts → letter goes to the assigned
  coach for review (replicates the handout's "send a copy to Matt" step in-app).
  Direct accounts → option to email a PDF copy + the "feeling stuck?" support path:
  in-app, "Get guidance" routes to coach messaging per their tier.
- **Export:** clean print/PDF, one page, large type, no app branding on the printed page.

## The referral hook (direct accounts)

After completing a letter, direct members see one calm card: "A letter like this is most
powerful read with professional support in the room. Talk to an interventionist about
what's next." → consultation request. Show once per completed letter; never pushy.

## Data model

```ts
interface LetterDraft { id: string; memberId: MemberId; familyId?: string;
  p1: { qualities: string[]; memory?: string; body: string };
  p2: { openerLabel: string; experiences: ExperienceBlock[] };   // max 3
  p3: { request: string; hope: string; healthySupport?: string;
        boundaries: ConfirmedBoundary[]; closingQuestion: string };
  status: 'draft'|'complete'; pageFillPct: number;
  sharedWithCoach: boolean; updatedAt: ISODate; }
interface ExperienceBlock { when: string; felt: string; }
interface ConfirmedBoundary { wallId?: string; text: string;
  anchor: 'enabling'|'harm'|'both'; followThroughConfirmed: true; }
```

Prompts, starters, examples, and coach notes ship as locale-keyed JSON so Matt can
revise wording without an app release.

## Account-state rules

- All tiers can write and export letters (mission, not upsell).
- Coach review: attached → assigned coach; direct-Premium → on-call coach;
  direct-Essential → email-a-PDF path only.

## Sensitive-content note

Letter content is among the most sensitive data in the app: encrypted at rest, excluded
from analytics, never used for model training, deleted with account deletion.

## Out of scope (v1)

AI-written letters (the writer's own words are the point; assistance is structural and
tone-flag only), collaborative editing, audio recording, multi-page letters (explicitly
against the method).

## Open questions

- Should the export include a discreet "prepared with Sober Helpline" footer on the
  app-screen view only (never print)? (Lean: no branding anywhere near this moment.)
- Direct-account PDF email: send via in-app share sheet (simplest, v1) or platform
  email service (adds infrastructure)? (Lean: share sheet.)
