/**
 * The kit's crisis screen: the same combined check invitation-coach runs
 * (invitation-specific violence/threat/self-harm patterns + the first-person
 * crisisKind check), over every free-text field that would reach the coach.
 */
import { invitationTextInCrisis } from './invitationCrisis';
import { SCREENED_FIELDS, screenInvitationFields, type ScreenInput, type ScreenedField } from './invitationScreen';
import { userInCrisis } from './invitationUserCrisis';

export function invitationInCrisis(text: string): boolean {
  return invitationTextInCrisis(text) || userInCrisis(text);
}

export function kitCrisisField(input: ScreenInput): ScreenedField | null {
  return screenInvitationFields(input, invitationInCrisis);
}

/**
 * What "I'm safe right now" is tied to: the exact texts that tripped the
 * screen (field + words), sorted. Typing a harmless observation keeps the
 * same key; a new hit anywhere — including in the observation — makes a new
 * key, so the panel comes back.
 */
export function kitCrisisKey(input: ScreenInput): string | null {
  const hits = new Set<string>();
  for (const field of SCREENED_FIELDS) {
    const value = input[field];
    const texts: readonly unknown[] = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    for (const text of texts) {
      if (typeof text === 'string' && text.trim() && invitationInCrisis(text)) hits.add(`${field}:${text.trim()}`);
    }
  }
  return hits.size ? JSON.stringify([...hits].sort()) : null;
}

/**
 * A hit the server's screen reported (patterns the app's twin missed, or
 * OpenAI moderation). `id` is new for every response, so "I'm safe right now"
 * covers that one hit only.
 */
export type ServerCrisis = {
  field: ScreenedField | 'unknown';
  source: 'patterns' | 'moderation';
  id: number;
};

/**
 * Her "I'm safe right now": the hits it covers (`key`) and the observation /
 * next step on screen when she tapped it. Personalize sends both texts, so
 * the server screens anything typed afterwards.
 */
export type KitAcknowledgement = { key: string; observation: string; nextStep: string };

export type KitCrisisState = {
  /** The field to show crisis resources for, or null (nothing hit, or she set it aside). */
  field: ScreenedField | 'unknown' | null;
  /** What "I'm safe right now" is tied to: every live hit, local and server. */
  key: string | null;
  /** She said she's safe right now for exactly these hits, this visit. */
  acknowledged: boolean;
};

/**
 * The kit's crisis state. Pattern hits (local) and server hits (patterns or
 * moderation) are both acknowledgeable; the key changes with any new hit —
 * a new tripping text or a new server response — so the panel comes back.
 */
export function kitCrisisState(
  input: ScreenInput,
  server: ServerCrisis | null,
  acknowledgedKey: string | null,
): KitCrisisState {
  const hitField = kitCrisisField(input) ?? server?.field ?? null;
  if (hitField === null) return { field: null, key: null, acknowledged: false };
  const serverKey = server ? `server:${server.source}:${server.field}:${server.id}` : null;
  const key = JSON.stringify([kitCrisisKey(input), serverKey]);
  const acknowledged = acknowledgedKey === key;
  return { field: acknowledged ? null : hitField, key, acknowledged };
}

/** Editing the observation clears a server hit (either source) that was in the observation. */
export function afterObservationEdit(server: ServerCrisis | null): ServerCrisis | null {
  return server?.field === 'observation' ? null : server;
}
