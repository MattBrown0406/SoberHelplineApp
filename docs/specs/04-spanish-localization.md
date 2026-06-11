# Feature Spec 04 — Spanish Localization

**Status:** Approved for build · **Priority:** build infrastructure NOW, translate continuously

**Key asset:** Matt is fluent in Spanish and is the translation reviewer of record. This
changes the strategy — we can ship warm, culturally right Spanish instead of vendor
translationese, and Spanish-speaking families can get crisis support from the founder.

## Why now

Latino families are heavily underserved in family-recovery tooling, family plays an
outsized cultural role in recovery decisions, and almost no competitor does this well.
This is a moat, not a checkbox. Retrofitting i18n later is 10x the cost — wire it in
before more features land.

## Architecture

- **Libraries:** `i18next` + `react-i18next` + `expo-localization`.
- **Rule from this commit forward: zero hardcoded user-facing strings.** Every string
  through `t('key')`. Add a lint rule (`i18next/no-literal-string`) to enforce.
- **Files:** `src/locales/en/*.json`, `src/locales/es/*.json` — namespaced per feature
  (`common`, `today`, `scripts`, `boundaries`, `tracker`, `learn`, `support`, `crisis`,
  `letters`, `rehearsal`, `alignment`).
- **Content as data:** scripts, boundary suggestions, accordion copy, letter section
  definitions, lesson metadata all live in locale-keyed JSON — not components.
- **Language setting:** follows device locale by default; manual override in Support tab
  (per-account, syncs). `es` covers all Spanish locales in v1 (neutral Latin American
  Spanish).
- **Formatting:** dates/numbers via `Intl` with active locale. No RTL needs.

## Translation voice guide (Matt reviews everything against this)

- **Register: tú**, warm and direct — the app speaks like a trusted coach, not a clinic.
  Exception: legal/medical-adjacent text (privacy, 911/988) stays formally clear.
- **Not literal — equivalent.** "Hold the wall" → defend the metaphor, not the words:
  *"mantén el muro"* / castle frame: *castillo, murallas, foso, puente levadizo* all
  translate beautifully — keep the metaphor fully intact.
- Key term decisions (Matt to confirm):
  - Coach → **coach** (widely used) or *acompañante*; Counselor → **consejero/a**
    (licensed only, as in English).
  - Check-in → *registro diario* or keep "check-in" (common in app Spanish).
  - "Anchored in answers, not emotions" → *"Anclado en respuestas, no en emociones."*
  - Hope. Help. Recovery. → *Esperanza. Ayuda. Recuperación.*
- **Tone flags (letter builder) need Spanish patterns** — accusation phrasing differs:
  "después de todo lo que hemos hecho por ti," "tú siempre," "tú nunca."

## Cultural adaptation (beyond translation)

- Scripts library: review scenarios with Matt for cultural fit — multigenerational
  households, the role of *respeto* with parents, faith references as optional comfort
  (many families will expect them; keep them opt-in).
- Groups: a Spanish-language group row in Support ("Familias en Recuperación") — platform
  network first, provider orgs can add their own.
- Crisis: 988 offers Spanish ("oprima 2") — say so in the crisis sheet es copy.

## Scope of v1 translation (in order)

1. App chrome + Today tab (check-in is the daily spine).
2. Crisis sheet + Support tab (safety surface — Matt reviews line by line first).
3. Boundaries tab incl. castle accordion (the heart of the teaching).
4. Scripts library (adaptation, not translation).
5. Tracker, Learn metadata, Alignment, Letter builder, Rehearsal.

App Store metadata (es-MX): name stays "Sober Helpline," subtitle/keywords/screenshots
localized.

## Workflow

1. Claude Code generates draft `es` JSON alongside every `en` change (same PR).
2. Matt reviews drafts in-file (or via a simple review checklist in the PR description).
3. `missingKeyHandler` logs untranslated keys in dev; CI check: `es` keys ⊇ `en` keys
   (fallback to `en` at runtime, never blank).

## Account-state / platform notes

- White-label orgs inherit both languages automatically; org-entered content (group
  names, meeting titles) displays as entered — orgs serving Spanish-speaking families
  enter their own Spanish.
- Provider console & super admin (website) localization: out of scope here; flag for the
  website repo.

## Out of scope (v1)

Other languages, per-coach language matching in crisis routing (v1.1: add a language
field to coach profiles so Spanish-speaking members route to Spanish-speaking coaches —
small change, big impact; build the field now, the routing later).

## Open questions

- Term choices above (coach/check-in) — Matt decides.
- Spanish-language Monday group on SoberHelpline.com as launch companion?
