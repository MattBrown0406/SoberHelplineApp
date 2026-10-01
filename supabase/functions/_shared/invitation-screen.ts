// Invitation Engine — which free-text field (if any) puts the family in crisis
// territory. Every field that reaches the coach is screened, in this order,
// and the first hit is reported so the app can point to the right place to
// review it. The text check itself is passed in (server: invitation-crisis +
// rehearsal-safety; app: their src/lib twins).
//
// KEEP IN SYNC with src/lib/invitationScreen.ts (identical below the header;
// tests/invitation-crisis.test.ts enforces it).

export const SCREENED_FIELDS = [
  'observation',
  'next_step',
  'recent_incidents',
  'usual_phrases',
  'costs_they_feel',
  'what_use_gives',
  'sober_moments',
  'use_triggers',
] as const;
export type ScreenedField = typeof SCREENED_FIELDS[number];

export type ScreenInput = Partial<Record<ScreenedField, string | readonly string[] | null | undefined>>;

/** Pattern-map fields and the setup step where each is edited. */
export const FIELD_SETUP_STEP: Readonly<Partial<Record<ScreenedField, string>>> = {
  recent_incidents: 'incidents',
  usual_phrases: 'phrases',
  costs_they_feel: 'costs',
  what_use_gives: 'gives',
  sober_moments: 'sober',
  use_triggers: 'triggers',
};

/** The first field whose text trips `inCrisis`, or null. */
export function screenInvitationFields(
  input: ScreenInput,
  inCrisis: (text: string) => boolean,
): ScreenedField | null {
  for (const field of SCREENED_FIELDS) {
    const value = input[field];
    const texts: readonly unknown[] = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    if (texts.some((text) => typeof text === 'string' && text.trim().length > 0 && inCrisis(text))) return field;
  }
  return null;
}
