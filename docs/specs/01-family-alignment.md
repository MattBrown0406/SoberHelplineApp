# Feature Spec 01 — Family Alignment

**Status:** Approved for build · **Priority:** 1 of 4

## Problem

Addiction exploits the gap between family members. One person holds a boundary, another quietly lowers the drawbridge — gives the money, makes the excuse — and the wall fails for everyone. Today the app treats each user as an island. Families recover as systems, not individuals.

## Concept

A shared **Family Space** where members commit to shared boundaries ("walls"), see each other's commitment status, and get help realigning when someone wavers. Extends the castle metaphor: one castle, many guardians, one set of walls.

## User stories

- As a family member, I can create a Family Space and invite others (spouse, siblings, grandparents) by link or code.
- As a member, I can propose a wall from the Boundaries tab to the family, anchored in the two questions (enabled? harmed?).
- As a member, I can commit to a proposed wall, decline it, or mark "I'm struggling with this one."
- As any member, I can see the Alignment view: each wall, who has committed, who is wavering.
- As a member having a weak moment, I can tap "I'm wavering" on a wall — family members who opted in get a supportive notification (never a shaming one).
- As an attached family's coach, I can see alignment status and wavering events for assigned families.
- As a direct member with no family joined, the app works exactly as today (solo mode is the default; alignment UI only appears once a second member joins).

## UX

**New surface:** "Family" section inside the Boundaries tab (not a new nav tab — keep the 6-tab spine).

1. **Shared walls list.** Each wall shows avatars of committed members. Full circle = aligned. A wavering member shows an amber ring.
2. **Alignment meter.** Simple fraction per wall ("3 of 4 holding") and a family-level summary ("Your castle: 5 walls, 4 fully held"). No scores or grades — this is solidarity, not surveillance.
3. **Propose flow.** From an anchored boundary → "Propose to family" → members get a card: the wall text, the proposer's two-questions answers (optional to share), Commit / Not yet buttons.
4. **Wavering flow.** Tapping "I'm wavering" on a committed wall → shows the wall's anchor answers back to the member + the matching script + optional "let my family know" and "ping our coach" (attached only).
5. **Weekly alignment check-in.** One added question to the existing daily check-in, weekly cadence: "Did you hold your walls this week?" (yes / mostly / I slipped). Private by default; sharing with family is opt-in per member.

## Privacy rules (important)

- Daily mood check-ins remain **private** to the individual (and coach, if attached). Never shared with family.
- Tracker logs (warning/recovery signs) remain private to the individual + coach.
- Only **walls, commitment status, and explicit "I'm wavering" signals** are family-visible, and wavering broadcast is opt-in at tap time.
- Any member can leave the Family Space; their private data leaves with them.

## Data model (additions to src/api/types.ts)

```ts
interface FamilySpace { id: string; name: string; createdBy: MemberId;
  orgId?: string; inviteCode: string; members: FamilyMember[]; }
interface FamilyMember { id: MemberId; displayName: string; role: 'owner'|'member';
  joinedAt: ISODate; }
interface SharedWall { id: string; familyId: string; text: string;
  proposedBy: MemberId; anchorAnswers?: AnchorAnswers; createdAt: ISODate;
  commitments: WallCommitment[]; }
interface WallCommitment { memberId: MemberId;
  status: 'committed'|'declined'|'wavering'; updatedAt: ISODate; }
interface WaveringEvent { id: string; wallId: string; memberId: MemberId;
  sharedWithFamily: boolean; coachPinged: boolean; createdAt: ISODate; }
```

## Account-state rules

- Attached: Family Space auto-links to the provider org; coach sees alignment + wavering events.
- Direct Essential: full alignment features; wavering "ping a coach" routes to on-call coach messaging.
- Direct free (if a free tier exists later): solo boundaries only; alignment is a paid feature.

## Notifications

- Wall proposed → family members.
- Member committed → proposer only.
- Wavering (opt-in) → family members, copy reviewed for tone: "Maria could use some backup on a wall today" — never "Maria is failing."

## Out of scope (v1)

In-family chat (use existing coach messaging; family chat invites conflict the app can't moderate), boundary voting/vetoes, minor children as members.

## Open questions

- Should a declined wall be visible as declined, or just "not committed"? (Lean: "not yet" only — avoid scorekeeping.)
- Max family size? (Suggest 8.)
