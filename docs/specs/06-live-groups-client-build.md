# Feature Spec 06 — Live Groups Client (LiveKit)

**Status:** Ready to build in Claude Code — REQUIRES a development build + device testing.
Server foundation already shipped: `livekit-token` edge function + `group_hosts` table.

## Hard constraint (read first)

LiveKit video uses `@livekit/react-native` + `@livekit/react-native-webrtc` — **native
modules.** They do NOT run in Expo Go or the web export. Therefore:

1. This needs an **Expo development build** (`npx expo run:ios` / EAS dev build), tested on
   a real device. It cannot be verified in the GitHub Pages web preview.
2. **Guard the native imports** so the web bundle still compiles and the browser preview
   keeps working: put all LiveKit code behind `Platform.OS !== 'web'`, and on web render a
   "Live groups are available in the mobile app" fallback. Do NOT let `@livekit/*` imports
   load on web. Use a `.native.tsx` / `.web.tsx` file split for the live screen.

## Connection contract (already built server-side)

- WebSocket URL: `wss://sober-helpline-75uawvbt.livekit.cloud` (safe to ship; put in config.ts as `EXPO_PUBLIC_LIVEKIT_URL`).
- Token: POST to the `livekit-token` edge function with `{ room }` and the user's Supabase
  auth header. Returns `{ token, isHost, identity }`.
- Room names (must match `group_hosts`): `shp-parents`, `shp-spouses`, `shp-boundaries`, `shp-treatment`.

## Roles (enforced in the token, don't re-decide client-side)

- **Host** (`isHost: true`): publishes camera + mic; sees the question queue; can remove participants (`roomAdmin`).
- **Viewer**: subscribes only — no camera/mic. Joins by first name. Posts questions via chat.

## Screens

1. **Group → Live entry.** On each moderated group row: if a host is live, show "Join Live"
   for viewers; the host account sees "Go Live." (Presence: query room participants or a
   lightweight `is_live` flag the host sets on start/stop.)
2. **Live room (host).** Self camera preview, participant count, the question chat with a
   "remove" affordance on each sender, end-broadcast control.
3. **Live room (viewer).** Host video full-bleed, your branding, a chat input for questions,
   the 911/988 safety line pinned at the bottom (consistent with crisis UI), leave control.

## Chat / questions

Use LiveKit data messages (`room.localParticipant.publishData`) or the LiveKit chat helper.
Render newest at bottom; viewers see their own + host highlights. Host view shows all,
each with sender name + remove button (`room.removeParticipant(identity)` — requires the
roomAdmin grant the token already gives hosts).

## Moderation

- Remove: host taps remove → `removeParticipant`. Removed identity is blocked from rejoin
  for the session (LiveKit handles this for the room session).
- Always-visible report path + the pinned 911/988 line.

## Branding (white-label)

Theme the room chrome from the org branding payload (same source as the rest of the app),
so a provider's families see their brand around the video.

## Dependencies

`npx expo install @livekit/react-native @livekit/react-native-webrtc`
Add the LiveKit config plugin to app.json per LiveKit's Expo guide (camera/mic permissions
are already declared for rehearsal; confirm both).

## Testing checklist (must do on devices)

- [ ] Web build still compiles & GitHub Pages preview unaffected (native imports guarded).
- [ ] Host (account in group_hosts) can start, camera publishes.
- [ ] Second device joins as viewer — sees host, no own camera.
- [ ] Viewer posts a question; host sees it.
- [ ] Host removes the viewer; viewer is dropped and can't rejoin that session.
- [ ] 911/988 line visible on the viewer screen.
- [ ] Leaving/ending cleans up (no ghost participants, no runaway minutes).

## Cost guardrail

LiveKit Build (free) tier = 5,000 participant-min/month. At launch volume (~3,900) this is
$0. Add a soft cap / alerting before opening to all providers so a runaway session doesn't
silently rack up minutes.
