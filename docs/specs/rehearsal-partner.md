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

`supabase/functions/rehearsal-partner` — one function, four modes:

- `reply`: returns the character's next line (short, in-character, temperament-driven)
  plus base64 MP3 audio when the scenario includes a `voice` choice.
- `debrief`: returns strict JSON `{ wentWell[], workOn[], drill, scores{} }`.
- `stt`: transcribes a recorded clip (OpenAI Whisper) so users can speak their lines.
- `tts`: re-synthesizes a line on demand (bubble replay).

Voice casting: the setup screen collects relationship (spouse / partner / son /
daughter / sibling / parent / friend), voice gender, and age band. Gender+age map
to an ElevenLabs voice (defaults in `DEFAULT_VOICE_MAP`; override any slot with
the `REHEARSAL_VOICE_MAP` secret using IDs from your Voice Library). Relationship
and age also feed the character prompt, so a tearful mother in her 60s and a
defensive son in his 20s perform differently. ElevenLabs failures degrade
gracefully to text-only — voice is a layer, never a blocker.

Auth required (user JWT via `supabase.functions.invoke` — anonymous calls are
rejected). Input caps: 30 messages/request, 600 chars/message, 1,200 chars of
script context. English and Spanish supported end to end (prompts follow the
app language).

### Deploy

```
supabase functions deploy rehearsal-partner
supabase secrets set OPENAI_API_KEY=sk-proj-...          # LLM (gpt-4o-mini) + Whisper STT
supabase secrets set ELEVENLABS_API_KEY=...              # voices
# Optional:
# supabase secrets set REHEARSAL_MODEL=gpt-4o            # if the character feels flat
# supabase secrets set REHEARSAL_VOICE_MAP='{"male":{"older":"yourVoiceId"}}'
```

Cost profile per 12-turn session (order of magnitude): gpt-4o-mini ≈ a fraction
of a cent; Whisper ≈ a cent or two; ElevenLabs (~60–90s of speech) is the main
cost — pennies to low dimes depending on plan. Keys live only in Supabase
secrets: never in the repo, never in the app bundle.

## Follow-ups (not in this change)

- Per-user daily session caps / entitlement gating (RevenueCat tier) once pricing
  is decided — the hook and function are structured so a cap check drops into the
  edge function cleanly.
- Full-duplex voice (LiveKit real-time streaming instead of turn-based clips).
- Session history: transcripts are intentionally not persisted anywhere in v1
  (privacy-first, matching the recorder's on-device-only stance).
