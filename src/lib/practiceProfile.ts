import type { LovedOneProfile } from './lovedOneProfile';

export type PracticeRelationship = 'spouse' | 'partner' | 'son' | 'daughter' | 'sibling' | 'parent' | 'friend';

/**
 * The slice of the family's loved-one profile that conversation practice sends
 * to the AI partner so it sounds like *their* person. Same caps as the server
 * (rehearsal-prompts.ts PROFILE_CAPS) so nothing is silently cut twice; the
 * server re-sanitizes regardless — it never trusts the client.
 */
export type PracticeProfile = {
  name?: string;
  relationship?: string;
  substances: string[];
  usualPhrases: string[];
  useTriggers: string[];
  whatUseGives: string[];
  costsTheyFeel: string[];
  recentIncidents: string[];
};

export const PRACTICE_PROFILE_CAPS = {
  substances: { items: 5, chars: 40 },
  usualPhrases: { items: 5, chars: 120 },
  useTriggers: { items: 4, chars: 100 },
  whatUseGives: { items: 4, chars: 100 },
  costsTheyFeel: { items: 4, chars: 100 },
  recentIncidents: { items: 4, chars: 160 },
} as const;

/** Quotes, delimiters and line breaks are stripped: these strings land inside a prompt. */
export function cleanProfileItem(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/["`“”„«»‹›|\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

function cleanList(value: unknown, cap: { items: number; chars: number }): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const cleaned = cleanProfileItem(item, cap.chars);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    if (out.length >= cap.items) break;
  }
  return out;
}

/**
 * Null unless the family has described something practice can use (their
 * phrases, triggers, incidents…): a name alone doesn't change the character.
 */
export function toPracticeProfile(profile: LovedOneProfile | null | undefined): PracticeProfile | null {
  if (!profile) return null;
  const practice: PracticeProfile = {
    name: cleanProfileItem(profile.name, 40) || undefined,
    relationship: cleanProfileItem(profile.relationship, 30) || undefined,
    substances: cleanList(profile.substances, PRACTICE_PROFILE_CAPS.substances),
    usualPhrases: cleanList(profile.usualPhrases, PRACTICE_PROFILE_CAPS.usualPhrases),
    useTriggers: cleanList(profile.useTriggers, PRACTICE_PROFILE_CAPS.useTriggers),
    whatUseGives: cleanList(profile.whatUseGives, PRACTICE_PROFILE_CAPS.whatUseGives),
    costsTheyFeel: cleanList(profile.costsTheyFeel, PRACTICE_PROFILE_CAPS.costsTheyFeel),
    recentIncidents: cleanList(profile.recentIncidents, PRACTICE_PROFILE_CAPS.recentIncidents),
  };
  const hasDetail =
    practice.usualPhrases.length > 0 ||
    practice.useTriggers.length > 0 ||
    practice.whatUseGives.length > 0 ||
    practice.costsTheyFeel.length > 0 ||
    practice.recentIncidents.length > 0;
  return hasDetail ? practice : null;
}

const RELATIONSHIP_WORDS: Record<string, PracticeRelationship> = {
  spouse: 'spouse', husband: 'spouse', wife: 'spouse', esposo: 'spouse', esposa: 'spouse', marido: 'spouse',
  partner: 'partner', boyfriend: 'partner', girlfriend: 'partner', fiance: 'partner', fiancee: 'partner',
  pareja: 'partner', novio: 'partner', novia: 'partner',
  son: 'son', hijo: 'son', stepson: 'son',
  daughter: 'daughter', hija: 'daughter', stepdaughter: 'daughter',
  sibling: 'sibling', brother: 'sibling', sister: 'sibling', hermano: 'sibling', hermana: 'sibling',
  parent: 'parent', mother: 'parent', father: 'parent', mom: 'parent', dad: 'parent',
  madre: 'parent', padre: 'parent', mama: 'parent', papa: 'parent',
  friend: 'friend', amigo: 'friend', amiga: 'friend',
};

/** Maps free-text relationships ("my husband", "Hijo") onto the practice partner's options. */
export function practiceRelationship(raw: string | null | undefined): PracticeRelationship | null {
  if (!raw) return null;
  const words = raw
    .toLowerCase()
    // Accent folding by hand: String.prototype.normalize isn't reliable on every JS engine the app runs on.
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (const word of words) {
    const match = RELATIONSHIP_WORDS[word];
    if (match) return match;
  }
  return null;
}
