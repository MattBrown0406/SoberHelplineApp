/**
 * A family's letter asking the prosecutor to let their loved one go to the
 * treatment the family arranged instead of jail, with completion, written
 * progress updates, and an in-person review of the charges afterward.
 *
 * Only names, the case number and the program's name are typed; everything
 * that lands mid-sentence is a choice rendered in the letter's own language,
 * so a Spanish-speaking mother can send a correct English letter.
 * Pure, so tests can pin the letter's commitments in both languages.
 */
export const PROSECUTOR_DETAIL_LIMIT = 160;
/** Characters a member can type per answer. */
export const PROSECUTOR_INPUT_MAX_LENGTH = 120;
export const PROSECUTOR_PROTECTED_BYTE_LIMIT = 1800;

export const PROSECUTOR_LETTER_LANGUAGES = ['en', 'es'] as const;
export type ProsecutorLetterLanguage = typeof PROSECUTOR_LETTER_LANGUAGES[number];

export const PROSECUTOR_RELATIONSHIPS = [
  'mother', 'father', 'wife', 'husband', 'partner', 'daughter', 'son', 'sister', 'brother',
  'grandmother', 'grandfather', 'aunt', 'uncle', 'relative',
] as const;
export const PROSECUTOR_LEVELS_OF_CARE = ['detoxResidential', 'residential', 'php', 'iop', 'outpatient'] as const;
export const PROSECUTOR_UPDATE_INTERVALS = ['weekly', 'biweekly', 'monthly'] as const;
export const PROSECUTOR_ATTORNEY_KINDS = ['named', 'publicDefender'] as const;

export type ProsecutorRelationship = typeof PROSECUTOR_RELATIONSHIPS[number];
export type ProsecutorLevelOfCare = typeof PROSECUTOR_LEVELS_OF_CARE[number];
export type ProsecutorUpdateInterval = typeof PROSECUTOR_UPDATE_INTERVALS[number];
export type ProsecutorAttorneyKind = typeof PROSECUTOR_ATTORNEY_KINDS[number];

/** Typed as written: names, the case number, the program's name. */
export const PROSECUTOR_TEXT_KEYS = ['lovedOneName', 'caseNumber', 'prosecutor', 'programName', 'attorney', 'yourName', 'contact'] as const;
export type ProsecutorTextKey = typeof PROSECUTOR_TEXT_KEYS[number];

export type ProsecutorLetter = Record<ProsecutorTextKey, string> & {
  relationship: ProsecutorRelationship | '';
  levelOfCare: ProsecutorLevelOfCare | '';
  updates: ProsecutorUpdateInterval | '';
  attorneyKind: ProsecutorAttorneyKind | '';
  /** YYYY-MM-DD on her calendar, or ''. */
  startDate: string;
  /** The prosecutor's office reads English; Spanish is there to read along. */
  letterLanguage: ProsecutorLetterLanguage;
  updatedAt: string | null;
};

const CHOICES = {
  relationship: PROSECUTOR_RELATIONSHIPS,
  levelOfCare: PROSECUTOR_LEVELS_OF_CARE,
  updates: PROSECUTOR_UPDATE_INTERVALS,
  attorneyKind: PROSECUTOR_ATTORNEY_KINDS,
} as const;
type ChoiceKey = keyof typeof CHOICES;
const CHOICE_KEYS = Object.keys(CHOICES) as ChoiceKey[];

export function defaultProsecutorLetter(): ProsecutorLetter {
  return {
    ...(Object.fromEntries(PROSECUTOR_TEXT_KEYS.map((key) => [key, ''])) as Record<ProsecutorTextKey, string>),
    relationship: '',
    levelOfCare: '',
    updates: '',
    attorneyKind: '',
    startDate: '',
    letterLanguage: 'en',
    updatedAt: null,
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function cap(value: string): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > PROSECUTOR_DETAIL_LIMIT) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function isChoice<K extends ChoiceKey>(key: K, value: unknown): value is typeof CHOICES[K][number] {
  return typeof value === 'string' && (CHOICES[key] as readonly string[]).includes(value);
}

function isLetterLanguage(value: unknown): value is ProsecutorLetterLanguage {
  return typeof value === 'string' && (PROSECUTOR_LETTER_LANGUAGES as readonly string[]).includes(value);
}

/** A real calendar date written YYYY-MM-DD. */
export function isLetterDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function prosecutorLetterProtectedByteLength(letter: ProsecutorLetter): number {
  return utf8ByteLength(JSON.stringify(letter));
}

function fitLetterToProtectedBudget(letter: ProsecutorLetter, changedKeys: string[]): ProsecutorLetter {
  if (prosecutorLetterProtectedByteLength(letter) <= PROSECUTOR_PROTECTED_BYTE_LIMIT) return letter;
  const next = { ...letter };
  const changedTextKeys = changedKeys.filter((key): key is ProsecutorTextKey =>
    (PROSECUTOR_TEXT_KEYS as readonly string[]).includes(key));
  for (const key of changedTextKeys.reverse()) {
    const characters = Array.from(next[key]);
    while (characters.length > 0 && prosecutorLetterProtectedByteLength(next) > PROSECUTOR_PROTECTED_BYTE_LIMIT) {
      characters.pop();
      next[key] = characters.join('');
    }
  }
  // Never throw from a tap or a read: trim the longest answer instead.
  while (prosecutorLetterProtectedByteLength(next) > PROSECUTOR_PROTECTED_BYTE_LIMIT) {
    const longest = [...PROSECUTOR_TEXT_KEYS].sort((a, b) => utf8ByteLength(next[b]) - utf8ByteLength(next[a]))[0];
    const characters = Array.from(next[longest]);
    if (characters.length === 0) throw new Error('protected_prosecutor_value_too_large');
    characters.pop();
    next[longest] = characters.join('');
  }
  return next;
}

export function updateProsecutorLetter(
  letter: ProsecutorLetter,
  patch: Partial<Omit<ProsecutorLetter, 'updatedAt'>>,
  now = new Date().toISOString(),
): ProsecutorLetter {
  const next: ProsecutorLetter = { ...letter, updatedAt: now };
  for (const [key, value] of Object.entries(patch)) {
    if ((PROSECUTOR_TEXT_KEYS as readonly string[]).includes(key)) {
      next[key as ProsecutorTextKey] = typeof value === 'string' ? cap(value) : '';
    } else if ((CHOICE_KEYS as string[]).includes(key)) {
      const choice = key as ChoiceKey;
      (next as Record<ChoiceKey, string>)[choice] = isChoice(choice, value) ? value : '';
    } else if (key === 'startDate') {
      next.startDate = isLetterDate(value) ? value : '';
    } else if (key === 'letterLanguage') {
      next.letterLanguage = isLetterLanguage(value) ? value : 'en';
    }
  }
  return fitLetterToProtectedBudget(next, Object.keys(patch));
}

export function parseProsecutorLetter(raw: string | null): ProsecutorLetter {
  if (raw === null) return defaultProsecutorLetter();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('protected_prosecutor_invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('protected_prosecutor_invalid_shape');
  }
  const source = parsed as Record<string, unknown>;
  const missingField = [...PROSECUTOR_TEXT_KEYS, ...CHOICE_KEYS, 'startDate', 'letterLanguage', 'updatedAt'].find((key) =>
    !Object.prototype.hasOwnProperty.call(source, key));
  if (missingField) throw new Error(`protected_prosecutor_missing_field:${missingField}`);
  const invalidText = PROSECUTOR_TEXT_KEYS.find((key) => typeof source[key] !== 'string');
  if (invalidText) throw new Error(`protected_prosecutor_invalid_field:${invalidText}`);
  const invalidChoice = CHOICE_KEYS.find((key) => source[key] !== '' && !isChoice(key, source[key]));
  if (invalidChoice) throw new Error(`protected_prosecutor_invalid_choice:${invalidChoice}`);
  if (source.startDate !== '' && !isLetterDate(source.startDate)) throw new Error('protected_prosecutor_invalid_start_date');
  if (!isLetterLanguage(source.letterLanguage)) throw new Error('protected_prosecutor_invalid_language');
  if (source.updatedAt !== null && (typeof source.updatedAt !== 'string' || !Number.isFinite(new Date(source.updatedAt).getTime()))) {
    throw new Error('protected_prosecutor_invalid_updated_at');
  }
  const letter: ProsecutorLetter = {
    ...(Object.fromEntries(PROSECUTOR_TEXT_KEYS.map((key) => [key, cap(source[key] as string)])) as Record<ProsecutorTextKey, string>),
    relationship: source.relationship as ProsecutorLetter['relationship'],
    levelOfCare: source.levelOfCare as ProsecutorLetter['levelOfCare'],
    updates: source.updates as ProsecutorLetter['updates'],
    attorneyKind: source.attorneyKind as ProsecutorLetter['attorneyKind'],
    startDate: source.startDate as string,
    letterLanguage: source.letterLanguage,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
  return fitLetterToProtectedBudget(letter, []);
}

/** The details the letter cannot go without; the prosecutor's name and her contact line are optional. */
export function prosecutorLetterProgress(letter: ProsecutorLetter): {
  ready: boolean;
  completed: number;
  total: number;
  missing: string[];
} {
  const checks: [string, boolean][] = [
    ['lovedOneName', !!letter.lovedOneName.trim()],
    ['caseNumber', !!letter.caseNumber.trim()],
    ['programName', !!letter.programName.trim()],
    ['levelOfCare', !!letter.levelOfCare],
    ['startDate', isLetterDate(letter.startDate)],
    ['updates', !!letter.updates],
    ['attorney', letter.attorneyKind === 'publicDefender' || (letter.attorneyKind === 'named' && !!letter.attorney.trim())],
    ['yourName', !!letter.yourName.trim()],
    ['relationship', !!letter.relationship],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([key]) => key);
  return { ready: missing.length === 0, completed: checks.length - missing.length, total: checks.length, missing };
}

export function prosecutorLetterStarted(letter: ProsecutorLetter): boolean {
  return PROSECUTOR_TEXT_KEYS.some((key) => letter[key].trim().length > 0)
    || CHOICE_KEYS.some((key) => letter[key] !== '')
    || letter.startDate !== '';
}

/** The admission date in the letter's language, read as a calendar date (no time-zone shift). */
export function formatLetterDate(value: string, language: ProsecutorLetterLanguage): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The signature line starts a line ("Madre de …"), unlike the phrase mid-sentence. */
function capitalize(line: string): string {
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * The letter in the language `t` is fixed to. A missing detail stays a
 * visible bracketed blank, so a letter shared early can be finished by hand.
 */
export function prosecutorLetterText(
  letter: ProsecutorLetter,
  t: Translate,
  today: string,
  language: ProsecutorLetterLanguage,
): string {
  const typed = (key: ProsecutorTextKey) => letter[key].trim() || t(`letter.blank.${key}`);
  const name = typed('lovedOneName');
  const fill = {
    name,
    caseNumber: typed('caseNumber'),
    program: typed('programName'),
    care: letter.levelOfCare ? t(`letter.care.${letter.levelOfCare}`) : t('letter.blank.levelOfCare'),
    startDate: isLetterDate(letter.startDate) ? formatLetterDate(letter.startDate, language) : t('letter.blank.startDate'),
    updates: letter.updates ? t(`letter.updates.${letter.updates}`) : t('letter.blank.updates'),
    attorney: typed('attorney'),
    yourName: typed('yourName'),
    relationship: letter.relationship ? t(`letter.relationship.${letter.relationship}`) : t('letter.blank.relationship'),
  };
  const prosecutor = letter.prosecutor.trim();
  const lines = [
    today,
    '',
    t('letter.re', fill),
    '',
    prosecutor ? t('letter.greetingNamed', { prosecutor }) : t('letter.greeting'),
    '',
    t('letter.opening', fill),
    '',
    t('letter.arranged', fill),
    '',
    t('letter.askHeading', fill),
    `1. ${t('letter.askComplete', fill)}`,
    `2. ${t('letter.askUpdates', fill)}`,
    `3. ${t('letter.askEarlyExit', fill)}`,
    `4. ${t('letter.askMeeting', fill)}`,
    '',
    t('letter.accountability', fill),
    '',
    t(letter.attorneyKind === 'publicDefender' ? 'letter.sharedPublicDefender' : 'letter.sharedAttorney', fill),
    '',
    t('letter.thanks'),
    '',
    t('letter.signoff'),
    fill.yourName,
    capitalize(t('letter.relationshipLine', fill)),
  ];
  const contact = letter.contact.trim();
  if (contact) lines.push(contact);
  return lines.join('\n');
}
