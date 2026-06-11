# Feature Spec 03 — Script Rehearsal

**Status:** Approved for build · **Priority:** 3 of 4

## Problem

The Scripts tab tells families what to say. Saying it out loud — voice steady, under guilt,
anger, and bargaining pressure — is a different skill. Families fold in the moment not
because they forgot the words but because they never practiced delivering them under fire.

## Concept

A practice mode attached to every script and every anchored wall: rehearse out loud,
hear yourself, then optionally practice against simulated pushback. Build in two phases.

## Phase A — Say It Out Loud (build first; no AI, no backend)

1. From any script or saved wall → "Practice this."
2. Screen shows the line large and clean (teleprompter style).
3. **Record yourself** saying it (expo-av, local storage only). Play back. Re-record.
4. Self-check prompts after playback (tap, not type): "Did you sound calm?" /
   "Did you add apologies or justifications that weren't in the script?" /
   "Could you say it 20% slower?"
5. **Practice counter** per script ("rehearsed 4 times") — rehearsal count feeds the
   Today tab's daily focus ("Boundary practice: money requests · 2-min rehearsal").
6. Recordings are local-only, deletable, never uploaded. State this in the UI.

## Phase B — Pressure Mode (AI roleplay; behind a feature flag)

Text-based first; voice later if it earns it.

1. Member picks a script + a pressure style the loved one actually uses:
   **Guilt** ("after everything I've done for you"), **Anger**, **Bargaining**
   ("just this once, I'll pay you back"), **Minimizing** ("you're overreacting"),
   **Crisis** ("you don't know what I'll do").
2. AI plays the loved one for a SHORT exchange — max 4 turns, then always ends with
   a debrief. The member's job each turn: restate the wall calmly, without taking the bait.
3. **Debrief screen:** what they held, where they got pulled (apologizing, negotiating,
   explaining more than once), one suggestion. Tone: corner coach, not grader.
4. Hard rules for the roleplay model:
   - Never play the loved one as abusive/threatening beyond the selected pressure style;
     never simulate self-harm threats even in Crisis style — Crisis style trains exactly one
     response: "I hear that you're hurting. If this is an emergency, call 911. I'll talk with
     you tomorrow." Then the exchange ends.
   - Max 4 turns. No open-ended chat. This is a drill, not a relationship simulator.
   - Visible exit ("End practice") on every turn + grounding line after intense sessions
     ("That was practice. Take a breath. You did the hard part.").
   - Every Pressure Mode screen shows: "This is practice with an AI, not advice.
     For real crisis support, tap Talk To Someone Now."
5. Session transcripts: local by default; "share with my coach" opt-in (attached/Premium).

## Family Alignment integration

A shared wall can show family rehearsal momentum ("3 of you have practiced this wall this
week") — practice as solidarity. Counts only, never recordings or transcripts.

## Data model

```ts
interface RehearsalSession { id: string; memberId: MemberId;
  source: { type:'script'|'wall'; id: string };
  mode: 'aloud'|'pressure'; pressureStyle?: 'guilt'|'anger'|'bargaining'|'minimizing'|'crisis';
  turns?: number; completedDebrief?: boolean; createdAt: ISODate; }
// Recordings: local file URIs only — never in API types.
```

## Account-state rules

- Phase A: all tiers, including attached (it's free to run — local only).
- Phase B: direct-Premium and attached (AI inference costs money); Essential sees a
  locked preview card.

## App Store / safety notes

- Phase B AI content must stay clearly framed as practice/coaching — no therapy claims.
- Crisis pressure style content needs Matt's review before ship (exact phrasing matters).
- Mic permission string: "Sober Helpline records practice sessions only when you tap
  record, and they stay on your device."

## Out of scope (v1)

Voice-to-voice AI roleplay, scoring/streaks for Pressure Mode (no gamifying conflict),
sharing recordings with family.

## Open questions

- Model choice + cost ceiling per session for Phase B.
- Should coaches be able to assign rehearsal homework? (Probably yes — v1.1, ties to
  provider console session notes.)
