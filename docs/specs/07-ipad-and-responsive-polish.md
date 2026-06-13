# Feature Spec 07 — iPad + Responsive Layout Polish

**Status:** Ready to build in Claude Code. REQUIRES testing on the iPad simulator
(and an iPhone simulator) via a dev build — layout work cannot be verified in the
web export alone.

**Context:** `supportsTablet: true` is now set in app.json. The app's screens were
authored for a ~400 px phone width, so on iPad they stretch full-width (long,
uncomfortable line lengths) and currently only run in portrait. This spec makes
the app feel native on every size and in both orientations, and fixes the known
responsive rough edges.

---

## Goals

1. **Comfortable layout on iPad** — content sits in a centered, max-width column
   instead of stretching edge to edge.
2. **Both orientations on iPad** — portrait AND landscape both look correct and
   never clip, overlap, or strand controls off-screen. (iPhone stays portrait-only.)
3. **Fix the known responsive bugs** listed below.
4. **No regressions** — iPhone (all sizes) and the web export keep working; the
   GitHub Pages preview still builds clean.

---

## 1. Orientation

- In `app.json`, change the top-level `"orientation": "portrait"` so iPad can rotate
  while iPhone stays portrait. Expo's single `orientation` key is global, so use the
  **`expo-screen-orientation`** approach OR set orientation per-device via the
  `ios.requireFullScreen`/`UISupportedInterfaceOrientations~ipad` route:
  - Set `app.json` → `ios.infoPlist`:
    - `UISupportedInterfaceOrientations` (iPhone) = `["UIInterfaceOrientationPortrait"]`
    - `UISupportedInterfaceOrientations~ipad` = all four orientations
      (`Portrait`, `PortraitUpsideDown`, `LandscapeLeft`, `LandscapeRight`).
  - Remove/relax the global `"orientation": "portrait"` so the iPad values take effect
    (set it to `"default"` and let the infoPlist arrays govern).
- Verify the app does NOT hard-depend on portrait anywhere (no fixed `height` equal to
  a captured screen height, no `Dimensions.get('window').height` cached at module load —
  read dimensions reactively; see §3).

## 2. Responsive layout system (the core change)

Create a single shared layout primitive and apply it everywhere, so this is
consistent and future screens inherit it:

- **`src/components/ui/ScreenContainer.tsx`** — wraps each screen's scroll content:
  - `SafeAreaView` + `ScrollView`.
  - Centers content with a **max content width of 640 px** (`alignSelf: 'center'`,
    `width: '100%'`, `maxWidth: 640`). On iPhone this is a no-op (screen < 640);
    on iPad it produces a comfortable centered column.
  - Horizontal padding that scales: 20 px on phone, more on large screens.
  - Accepts a `scroll` prop (default true) and passes through `contentContainerStyle`.
- Refactor each screen to use `ScreenContainer` instead of bare `SafeAreaView`+`ScrollView`:
  Today, Scripts, Boundaries, Tracker, Learn, Support, Settings, Letter, Rehearsal,
  Chat, Book-Coaching, all `(auth)` and `(onboarding)` screens.
- Use a **`useResponsive()` hook** (`src/hooks/useResponsive.ts`) returning
  `{ width, height, isTablet, isLandscape }` from `useWindowDimensions()` (reactive —
  updates on rotation). `isTablet = width >= 768`.

## 3. Known responsive bugs to fix

- **Cached Dimensions:** replace any `Dimensions.get(...)` read at module/render top
  with `useWindowDimensions()` so rotation and split-view resize reflow correctly.
- **Fixed-width cards / rows:** audit for hard-coded pixel widths that assume a phone
  (e.g., paywall tier rows, crisis sheet, group rows, session rows). Make them
  `width: '100%'` within the max-width container.
- **Crisis sheet modal:** on iPad it currently slides full-width; constrain it to a
  centered sheet (max 520 px) so it doesn't span the whole tablet. Keep it bottom-anchored
  on iPhone.
- **Live room (LiveKit) on iPad/landscape:** video should fill correctly in landscape;
  the chat panel should sit beside the video in landscape (two-column) and below it in
  portrait. Guard remains: native-only, web shows the fallback.
- **Onboarding / auth full-screen panels:** vertically center content on tall iPad
  screens rather than top-aligning with large empty space; cap the card width at 480 px.
- **KeyboardAvoidingView:** confirm chat + letter + booking inputs stay visible above the
  keyboard on iPad (the keyboard is a different height; test in both orientations).
- **Tab bar:** confirm the bottom tab bar spacing looks right on iPad (icons shouldn't be
  marooned at far edges — they're fine centered since the bar is full width, but verify).
- **Splash/landscape:** confirm the splash image scales (contain) and the navy background
  fills in landscape (no white bars).
- **Safe-area insets:** use `react-native-safe-area-context` insets on all four edges
  (landscape iPad has side insets / home indicator differently than portrait).

## 4. Acceptance checklist (test on simulators via dev build)

Run each on: iPhone (e.g., 15), iPad (e.g., 13" Pro) portrait, iPad landscape.

- [ ] Web export still builds clean; GitHub Pages preview unaffected.
- [ ] iPhone screens visually unchanged (max-width is a no-op below 640 px).
- [ ] iPad portrait: content is a centered column, comfortable line length, no edge-to-edge stretch.
- [ ] iPad landscape: no clipping, no overlap, all CTAs reachable; rotating live (portrait↔landscape) reflows without restart.
- [ ] Crisis sheet is a centered sheet on iPad, bottom sheet on iPhone; 911/988 always visible.
- [ ] Onboarding + auth cards centered, capped width, no giant empty gaps.
- [ ] Chat / letter / booking inputs stay above the keyboard in both orientations.
- [ ] Live room: video + chat usable in both orientations (native build); web shows fallback.
- [ ] Splash fills correctly in landscape (no white bars).
- [ ] No use of stale `Dimensions.get` — rotation reflows everywhere.

## 5. Out of scope (note, don't build now)

- True two-pane iPad layouts (e.g., master-detail list + content). The max-width column
  is the right v1; multi-pane is a later enhancement once iPad usage justifies it.

## Commit guidance

Small, reviewable commits: (1) orientation config, (2) ScreenContainer + useResponsive,
(3) screen refactors in batches, (4) crisis sheet + live room responsive, (5) bug-fix
pass. Run `npx tsc --noEmit` before each commit; keep the web build green.
