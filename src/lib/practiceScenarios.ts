/**
 * Conversation-practice vocabulary shared by the practice screens and the
 * rehearsal-partner edge function (supabase/functions/_shared/rehearsal-prompts.ts
 * holds the server's copy; tests/practice-scenarios.test.ts keeps them in sync).
 */

export const PARTNER_TEMPERAMENTS = ['guarded', 'defensive', 'volatile', 'tearful'] as const;
export type PartnerTemperament = (typeof PARTNER_TEMPERAMENTS)[number];

/** Standard practice: the circumstance the member walks into (they speak first). */
export const PRACTICE_SITUATIONS = [
  'said_no',
  'money_urgent',
  'relapse_after_treatment',
  'er_aftermath',
  'arrest_aftermath',
] as const;
export type PracticeSituation = (typeof PRACTICE_SITUATIONS)[number];

/** Incoming call: the crisis the loved one is already in when they call. */
export const INCOMING_PRESETS = [
  'late_night_pickup',
  'money_urgent',
  'relapse_confession',
  'crisis_blame',
  'relapse_after_treatment',
  'er_aftermath',
  'arrest_aftermath',
] as const;
export type CrisisPreset = (typeof INCOMING_PRESETS)[number];

export const PRACTICE_SOURCES = ['letter', 'invitation', 'script'] as const;
export type PracticeSource = (typeof PRACTICE_SOURCES)[number];

/** A one-page letter (1,500 characters) plus its confirmed boundaries. */
export const MAX_PRACTICE_TEXT_CHARS = 2400;

export const WARMUP_SECONDS = 90;
export const WARMUP_MAX_USER_TURNS = 3;

/** One line to the partner (the server caps ordinary turns at the same length). */
export const MAX_LINE_CHARS = 600;

/** Ordinary lines: a recording stops here. */
export const MAX_CLIP_MS = 170_000;

/**
 * Reading a letter aloud gets longer: a one-page letter plus its boundaries
 * can run past three minutes. Still well under the upload cap below.
 */
export const MAX_READ_ALOUD_MS = 225_000;

/**
 * Base64 cap for one recorded clip — mirrors MAX_AUDIO_B64 in
 * supabase/functions/_shared/rehearsal-prompts.ts (a test keeps them equal):
 * the longest clip (225 s read-aloud at 64 kbps ≈ 2.4 M) plus ~25% for
 * encoder overshoot.
 */
export const MAX_AUDIO_B64 = 3_000_000;

/**
 * Text that arrives in a URL (a deep link, another screen) is capped tightly
 * and flattened to plain words — a long letter only travels through the
 * in-memory handoff (practiceHandoff.ts).
 */
export const MAX_URL_TEXT_CHARS = 600;

/** Strip anything shaped like a chat role, a special token, or the partner's break token. */
export function stripRoleMarkers(text: string): string {
  return text
    .replace(/BREAK[_\s-]*CHARACTER/gi, ' ')
    .replace(/<\|[^|>]{0,40}\|>/g, ' ')
    .replace(/\[\/?(?:INST|SYS|SYSTEM)\]/gi, ' ')
    .replace(/(^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:system|assistant|user|developer|human|ai|sistema|asistente|usuario)[ \t]*:/gi, '$1')
    .replace(/#{3,}/g, ' ');
}

/** URL text → one plain line, at most MAX_URL_TEXT_CHARS. */
export function cleanUrlText(raw: unknown): { text: string | null; truncated: boolean } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return { text: null, truncated: false };
  const flat = stripRoleMarkers(value.replace(/\r\n?/g, '\n')).replace(/\s+/g, ' ').trim();
  return { text: flat.slice(0, MAX_URL_TEXT_CHARS).trim() || null, truncated: flat.length > MAX_URL_TEXT_CHARS };
}

/**
 * Fit a draft to one line, cutting at a word boundary. Speech-to-text can
 * return far more than one line; the full transcript was already screened for
 * a crisis by the server when it was transcribed, so trimming here is safe.
 */
export function clampLine(text: string, max = MAX_LINE_CHARS): { text: string; clamped: boolean } {
  if (text.length <= max) return { text, clamped: false };
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return { text: (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd(), clamped: true };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function firstParam(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export type PracticeRouteParams = {
  practiceText: string | null;
  /** The prepared text was longer than one delivery can carry and was cut — tell the member. */
  practiceTextTruncated: boolean;
  source: PracticeSource | null;
  warmup: boolean;
  situation: PracticeSituation | null;
  temperament: PartnerTemperament | null;
};

/**
 * Route params arrive as untrusted strings (deep links, other screens).
 * `practiceText` is the exact text the member wants to practice delivering —
 * a short Invitation Engine line as a param (capped and flattened), or a long
 * text (the letter) handed over in memory (see practiceHandoff.ts), which wins
 * when present.
 */
export function parsePracticeParams(
  params: Record<string, unknown>,
  handoff?: { text: string; source: PracticeSource } | null,
): PracticeRouteParams {
  let practiceText: string | null;
  let practiceTextTruncated: boolean;
  if (handoff) {
    const normalized = stripRoleMarkers(handoff.text.replace(/\r\n?/g, '\n')).trim();
    practiceText = normalized.slice(0, MAX_PRACTICE_TEXT_CHARS) || null;
    practiceTextTruncated = normalized.length > MAX_PRACTICE_TEXT_CHARS;
  } else {
    const fromUrl = cleanUrlText(params.practiceText);
    practiceText = fromUrl.text;
    practiceTextTruncated = fromUrl.truncated;
  }
  const warmupRaw = firstParam(params.warmup);
  return {
    practiceText,
    practiceTextTruncated,
    source: practiceText ? (handoff ? handoff.source : oneOf(firstParam(params.source), PRACTICE_SOURCES)) : null,
    warmup: warmupRaw === '1' || warmupRaw === 'true',
    situation: oneOf(firstParam(params.situation), PRACTICE_SITUATIONS),
    temperament: oneOf(firstParam(params.temperament), PARTNER_TEMPERAMENTS),
  };
}

/**
 * Warm-up ends itself: after the third exchange, or once the 90 seconds are up
 * and the latest reply has landed — never mid-recording, mid-reply, while the
 * member still has words in the box, or after a crisis break.
 */
export function warmupShouldFinish(state: {
  secondsLeft: number;
  userTurns: number;
  lastRole: 'user' | 'partner' | null;
  busy: boolean;
  /** After a crisis break the warm-up never advances: the crisis card stays on screen. */
  safetyBreak: boolean;
}): boolean {
  if (state.safetyBreak || state.busy || state.userTurns === 0 || state.lastRole !== 'partner') return false;
  return state.userTurns >= WARMUP_MAX_USER_TURNS || state.secondsLeft <= 0;
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
