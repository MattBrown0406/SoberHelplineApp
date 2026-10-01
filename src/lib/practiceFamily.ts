/**
 * Family rehearsal: up to four people take turns speaking to the AI loved one
 * from one device. The member picks who is speaking before each line.
 */

export const MAX_FAMILY_SPEAKERS = 4;
export const SPEAKER_NAME_MAX = 30;

export const SPEAKER_RELATIONSHIPS = [
  'mother',
  'father',
  'spouse',
  'partner',
  'sibling',
  'child',
  'grandparent',
  'friend',
  'other',
] as const;
export type SpeakerRelationship = (typeof SPEAKER_RELATIONSHIPS)[number];

export type FamilySpeaker = { name: string; relationship: SpeakerRelationship };

/**
 * Names become "[Name]" prefixes on the transcript the AI reads, so brackets,
 * quotes, colons and line breaks are stripped (the server strips them again).
 */
export function cleanSpeakerName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[[\]{}<>:"`“”«»|\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPEAKER_NAME_MAX)
    .trim();
}

/** Who the member most likely is, given who their loved one is to them. */
export function memberRelationshipFor(lovedOneRelationship: string | null | undefined): SpeakerRelationship {
  switch (lovedOneRelationship) {
    case 'son':
    case 'daughter':
      return 'mother';
    case 'spouse':
      return 'spouse';
    case 'partner':
      return 'partner';
    case 'sibling':
      return 'sibling';
    case 'parent':
      return 'child';
    case 'friend':
      return 'friend';
    default:
      return 'other';
  }
}

/** The speakers actually sent: named, deduplicated by name, at most four. */
export function activeFamilySpeakers(speakers: readonly FamilySpeaker[]): FamilySpeaker[] {
  const out: FamilySpeaker[] = [];
  for (const speaker of speakers) {
    const name = cleanSpeakerName(speaker.name);
    if (!name || out.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    const relationship = (SPEAKER_RELATIONSHIPS as readonly string[]).includes(speaker.relationship)
      ? speaker.relationship
      : 'other';
    out.push({ name, relationship });
    if (out.length >= MAX_FAMILY_SPEAKERS) break;
  }
  return out;
}

/** A family rehearsal needs at least two named people; otherwise it's a solo practice. */
export function familyReady(speakers: readonly FamilySpeaker[]): boolean {
  return activeFamilySpeakers(speakers).length >= 2;
}

export function addSpeaker(speakers: readonly FamilySpeaker[], speaker: FamilySpeaker): FamilySpeaker[] {
  if (speakers.length >= MAX_FAMILY_SPEAKERS) return [...speakers];
  return [...speakers, speaker];
}

export function removeSpeaker(speakers: readonly FamilySpeaker[], index: number): FamilySpeaker[] {
  return speakers.filter((_, i) => i !== index);
}

export function updateSpeaker(
  speakers: readonly FamilySpeaker[],
  index: number,
  patch: Partial<FamilySpeaker>,
): FamilySpeaker[] {
  return speakers.map((s, i) => (i === index ? { ...s, ...patch } : s));
}
