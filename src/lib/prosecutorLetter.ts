/**
 * A family's letter asking the prosecutor to let their loved one go to the
 * treatment the family arranged instead of jail, with completion, written
 * progress updates, and an in-person review of the charges afterward.
 * Pure, so tests can pin the letter's commitments in both languages.
 */
export const PROSECUTOR_DETAIL_LIMIT = 160;
/** Characters a member can type per answer. */
export const PROSECUTOR_INPUT_MAX_LENGTH = 120;
export const PROSECUTOR_PROTECTED_BYTE_LIMIT = 1800;

export const PROSECUTOR_LETTER_LANGUAGES = ['en', 'es'] as const;
export type ProsecutorLetterLanguage = typeof PROSECUTOR_LETTER_LANGUAGES[number];

export const PROSECUTOR_TEXT_KEYS = [
  'lovedOneName',
  'caseNumber',
  'prosecutor',
  'program',
  'startDate',
  'updates',
  'attorney',
  'yourName',
  'relationship',
  'contact',
] as const;
export type ProsecutorTextKey = typeof PROSECUTOR_TEXT_KEYS[number];
/** The prosecutor's name and her contact line are optional. */
const REQUIRED_TEXT: readonly ProsecutorTextKey[] = [
  'lovedOneName', 'caseNumber', 'program', 'startDate', 'updates', 'attorney', 'yourName', 'relationship',
];

export type ProsecutorLetter = Record<ProsecutorTextKey, string> & {
  /** The prosecutor's office reads English; Spanish is there to read along. */
  letterLanguage: ProsecutorLetterLanguage;
  updatedAt: string | null;
};

export function defaultProsecutorLetter(): ProsecutorLetter {
  return {
    ...(Object.fromEntries(PROSECUTOR_TEXT_KEYS.map((key) => [key, ''])) as Record<ProsecutorTextKey, string>),
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

function isLetterLanguage(value: unknown): value is ProsecutorLetterLanguage {
  return typeof value === 'string' && (PROSECUTOR_LETTER_LANGUAGES as readonly string[]).includes(value);
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
  const textPatch = Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => (PROSECUTOR_TEXT_KEYS as readonly string[]).includes(key))
      .map(([key, value]) => [key, typeof value === 'string' ? cap(value) : '']),
  ) as Partial<ProsecutorLetter>;
  const letterLanguage = patch.letterLanguage === undefined
    ? letter.letterLanguage
    : isLetterLanguage(patch.letterLanguage) ? patch.letterLanguage : 'en';
  return fitLetterToProtectedBudget({ ...letter, ...textPatch, letterLanguage, updatedAt: now }, Object.keys(patch));
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
  const missingField = [...PROSECUTOR_TEXT_KEYS, 'letterLanguage', 'updatedAt'].find((key) =>
    !Object.prototype.hasOwnProperty.call(source, key));
  if (missingField) throw new Error(`protected_prosecutor_missing_field:${missingField}`);
  const invalidText = PROSECUTOR_TEXT_KEYS.find((key) => typeof source[key] !== 'string');
  if (invalidText) throw new Error(`protected_prosecutor_invalid_field:${invalidText}`);
  if (!isLetterLanguage(source.letterLanguage)) throw new Error('protected_prosecutor_invalid_language');
  if (source.updatedAt !== null && (typeof source.updatedAt !== 'string' || !Number.isFinite(new Date(source.updatedAt).getTime()))) {
    throw new Error('protected_prosecutor_invalid_updated_at');
  }
  const letter: ProsecutorLetter = {
    ...(Object.fromEntries(PROSECUTOR_TEXT_KEYS.map((key) => [key, cap(source[key] as string)])) as Record<ProsecutorTextKey, string>),
    letterLanguage: source.letterLanguage,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
  return fitLetterToProtectedBudget(letter, []);
}

export function prosecutorLetterProgress(letter: ProsecutorLetter): {
  ready: boolean;
  completed: number;
  total: number;
  missing: ProsecutorTextKey[];
} {
  const missing = REQUIRED_TEXT.filter((key) => !letter[key].trim());
  return { ready: missing.length === 0, completed: REQUIRED_TEXT.length - missing.length, total: REQUIRED_TEXT.length, missing };
}

export function prosecutorLetterStarted(letter: ProsecutorLetter): boolean {
  return PROSECUTOR_TEXT_KEYS.some((key) => letter[key].trim().length > 0);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The letter in the language `t` is fixed to. A blank answer stays a visible
 * bracketed blank, so a letter shared early can still be finished by hand.
 */
export function prosecutorLetterText(letter: ProsecutorLetter, t: Translate, date: string): string {
  const value = (key: ProsecutorTextKey) => letter[key].trim() || t(`letter.blank.${key}`);
  const name = value('lovedOneName');
  const fill = {
    date,
    name,
    caseNumber: value('caseNumber'),
    program: value('program'),
    startDate: value('startDate'),
    updates: value('updates'),
    attorney: value('attorney'),
    yourName: value('yourName'),
    relationship: value('relationship'),
  };
  const prosecutor = letter.prosecutor.trim();
  const lines = [
    t('letter.date', fill),
    '',
    t('letter.re', fill),
    '',
    prosecutor ? t('letter.greetingNamed', { prosecutor }) : t('letter.greeting'),
    '',
    t('letter.opening', fill),
    '',
    t('letter.arranged', fill),
    '',
    t('letter.askHeading'),
    `1. ${t('letter.askComplete', fill)}`,
    `2. ${t('letter.askUpdates', fill)}`,
    `3. ${t('letter.askEarlyExit', fill)}`,
    `4. ${t('letter.askMeeting', fill)}`,
    '',
    t('letter.accountability', fill),
    '',
    t('letter.attorneyCopy', fill),
    '',
    t('letter.thanks'),
    '',
    t('letter.signoff'),
    fill.yourName,
    t('letter.relationshipLine', fill),
  ];
  const contact = letter.contact.trim();
  if (contact) lines.push(contact);
  return lines.join('\n');
}
