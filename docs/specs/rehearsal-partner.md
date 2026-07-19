# Rehearsal Partner (AI practice conversations)

The Rehearsal Room's live layer: after (or instead of) teleprompter practice, the user
has the actual conversation with an AI playing their loved one, then receives coach
feedback scored against the intervention framework (love first, "I" statements, calm
under bait, return to the ask).

## Flow

1. `app/rehearsal.tsx` gains a "Practice with a partner" button (visible in the
   `prompt` and `done` phases). It routes to `/rehearsal-live` carrying the same
   `text` + `sourceId` params, so the script being practiced becomes context for
   the role-play.
2. `app/rehearsal-live.tsx` — three stages:
   - **Setup**: temperament picker (guarded / defensive / volatile / tearful).
     Relationship, first name, and substances are prefilled from `useLovedOne`.
   - **Chat**: user speaks first. The AI replies in character, capped at 12 user
     turns per session (`MAX_USER_TURNS` in `useRehearsalPartner`).
   - **Debrief**: coach feedback — scores (4 dimensions), what worked, what to
     tighten, one drill. Completing a debrief increments the existing
     `useRehearsalCount` for the source script.
3. Safety: if the user's own messages suggest personal crisis, the model breaks
   character (server-detected via a sentinel token), the input locks, and a card
   links to `/crisis-mode`.

## Backend

`supabase/functions/rehearsal-partner` — one function, two modes:

- `reply`: returns the character's next line. Short, in-character, temperament-driven.
- `debrief`: returns strict JSON `{ wentWell[], workOn[], drill, scores{} }`.

Auth required (user JWT via `supabase.functions.invoke` — anonymous calls are
rejected). Input caps: 30 messages/request, 600 chars/message, 1,200 chars of
script context. English and Spanish supported end to end (prompts follow the
app language).

### Deploy

```
supabase functions deploy rehearsal-partner
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # required
supabase secrets set REHEARSAL_MODEL=claude-sonnet-4-5   # optional override
```

## Follow-ups (not in this change)

- Per-user daily session caps / entitlement gating (RevenueCat tier) once pricing
  is decided — the hook and function are structured so a cap check drops into the
  edge function cleanly.
- Voice mode: the LiveKit stack already in the app could carry a spoken version
  of the same loop.
- Session history: transcripts are intentionally not persisted anywhere in v1
  (privacy-first, matching the recorder's on-device-only stance).
