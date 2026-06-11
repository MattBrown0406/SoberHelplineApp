# Feature Spec 02 — Intervention Letter Builder

**Status:** Approved for build — ⚠️ STRUCTURE PENDING REVIEW: sections below follow
standard intervention-letter practice; Matt's actual family handout will replace/refine
the section structure and coaching copy when attached. Build the engine so section
definitions are data, not code.

## Problem

Before an intervention (and often without one), family members need to say what addiction
has done to their relationship — in a way that can be heard. Unguided, they write
accusations, ultimatums, or essays of pain that close the loved one down. Matt hands
families a structured letter guide today; this feature turns that guide into a step-by-step
builder.

## Concept

A guided writer that walks a family member through composing an intervention/impact letter
section by section, with do/don't coaching, tone flagging, and export for intervention day.
Lives in the Scripts tab as a featured card ("Write the letter").

## Letter structure (v1 — replace with Matt's handout when provided)

1. **Love first.** Open with the relationship, a specific good memory, why they matter.
   *Coach: no "but" in this section.*
2. **What I've seen.** 2–4 specific, factual moments — dates, events, observations.
   *Coach: facts, not characterizations. "On Christmas Eve you didn't come home" not
   "you always ruin holidays."*
3. **How it has affected me.** I-statements about the writer's own fear, sleep, finances,
   health. Ties to anchor question 2 (Has the addiction harmed me?).
4. **My part.** Optional, powerful: where the writer enabled — ties to anchor question 1.
   *"I've protected you from consequences, and I see now that protected the addiction."*
5. **The ask.** One clear sentence: accept the help being offered today.
6. **My wall.** What the writer will and won't do going forward, anchored, regardless of
   the answer. Pulls saved walls from the Boundaries tab.
7. **Close with love.** The door is open; the drawbridge position is theirs to change.

## UX

- **Section-by-section flow.** One section per screen: prompt, 2–3 example lines
  (genericized), text area, per-section "why this matters" expander.
- **Tone flags (local, simple).** Highlight (never block) when a draft contains
  accusation patterns: "you always," "you never," "after everything," "how could you,"
  profanity, ALL CAPS runs. Suggestion chip: "Try describing one specific moment instead."
  v1 is a wordlist + patterns; no AI dependency required.
- **Boundary import.** Section 6 lists the writer's anchored walls → tap to insert.
- **Read-aloud timer.** Letters get read out loud; show estimated reading time
  (target 3–5 minutes; warn past 7).
- **Save/resume drafts.** Multiple letters (one per family member writing).
- **Export.** Clean print/PDF view, large type. No app branding on the printed page —
  this gets read across a living room.
- **Share with coach** (attached): coach reviews and comments before intervention day.

## The referral hook (direct accounts)

After a letter is completed, direct members see one calm card: "A letter is most powerful
read with professional support in the room. Talk to an interventionist about what's next."
→ provider matching / consultation request. This is the app's single strongest bridge to
Matt's practice; do not make it pushy — show once per completed letter.

## Family Alignment integration

If a Family Space exists, the builder shows which other members have completed letters
(status only — letter contents stay private to each writer + coach until they choose to
share on intervention day).

## Data model

```ts
interface LetterSectionDef { id: string; order: number; title: string; prompt: string;
  whyItMatters: string; examples: string[]; toneRules?: ToneRule[]; optional?: boolean; }
interface LetterDraft { id: string; memberId: MemberId; familyId?: string;
  sections: Record<string, string>; status: 'draft'|'complete'; readingSeconds: number;
  sharedWithCoach: boolean; updatedAt: ISODate; }
interface ToneRule { pattern: string; flag: string; suggestion: string; }
```

Section definitions ship as JSON (en + es) so Matt's handout revisions don't require
app releases.

## Account-state rules

- All tiers can write and export letters (this is mission, not upsell).
- Coach review requires attached, or direct-Premium via on-call coach.

## Sensitive-content note

Letter content is among the most sensitive data in the app: encrypted at rest, excluded
from analytics, never used as training data, deleted with account deletion.

## Out of scope (v1)

AI letter generation (the writer's own words are the point; AI assists tone only — and
even that is wordlist-based in v1), collaborative editing, audio recording of letters.

## Open questions

- ⚠️ Await Matt's handout: section order, naming, and coaching language.
- Should section 4 ("My part") be default-on or default-off? (Lean: on, skippable.)
