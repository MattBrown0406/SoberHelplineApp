/**
 * Voice delivery feedback for conversation practice. Pure: everything is
 * computed on the device from what was said (and, for spoken turns, how long
 * it took and how loud it got). Audio itself is never stored — only this
 * small report, inside the saved session's debrief.
 */

export type DeliveryLanguage = 'en' | 'es';

/** One hold-to-talk recording: what Whisper heard, how long it ran, and loudness samples (dBFS). */
export type VoiceClip = { transcript: string; durationMs: number; metering?: number[] };

export type DeliveryTurn = { text: string; clips?: VoiceClip[] };

export type DeliveryTipKey =
  | 'paceFast'
  | 'fillersHigh'
  | 'youHeavy'
  | 'longTurns'
  | 'loudPeaks'
  | 'noQuestions'
  | 'paceSteady'
  | 'fillersLow'
  | 'iStrong'
  | 'questionsAsked'
  | 'steadyVolume'
  | 'shortTurns';

export type DeliveryTip = { key: DeliveryTipKey; vars: Record<string, string | number> };

export type DeliveryReport = {
  userTurns: number;
  voiceTurns: number;
  /** Spoken words per minute across voice turns; null when nothing was spoken. */
  wordsPerMinute: number | null;
  /** Filler words in what was spoken; null when nothing was spoken. */
  fillerCount: number | null;
  /** Most frequent fillers, most common first. */
  topFillers: string[];
  iStatements: number;
  youStatements: number;
  questions: number;
  avgTurnWords: number;
  /** Null when no recording reported loudness (e.g. web, or typed only). */
  loudness: { meteredTurns: number; spikeTurns: number; peakDb: number } | null;
  tips: DeliveryTip[];
};

export const MAX_METERING_SAMPLES = 1200;

// Hermes-safe regexes: no lookbehind and no \p{…} classes. Latin letters
// (with accents) cover English and Spanish.
const LETTER = 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F';
const WORD_RE = new RegExp(`[${LETTER}0-9]+(?:['’][${LETTER}]+)*`, 'g');

export function wordCount(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/** A whole word/phrase: not preceded or followed by another letter (or an apostrophe). */
function standalone(body: string): RegExp {
  return new RegExp(`(?:^|[^${LETTER}'’])(?:${body})(?![${LETTER}'’])`, 'gim');
}

// Fillers only count where they are fillers: "like" or "I mean" between
// commas, "you know" at the end of a thought — not "I'd like you to come".
const FILLERS: Record<DeliveryLanguage, { label: string; re: RegExp }[]> = {
  en: [
    { label: 'um', re: standalone('u+m+|u+h+m+|e+r+m+') },
    { label: 'uh', re: standalone('u+h+|e+r+|a+h+') },
    { label: 'hmm', re: standalone('h+m+|m{2,}') },
    { label: 'like', re: /(?:^|[,—-]\s*)like(?=\s*[,—-])/gim },
    { label: 'you know', re: /\byou know(?=\s*(?:[,.!?…—-]|$))/gim },
    { label: 'I mean', re: /(?:^|[,.!?—-]\s*)i mean(?=\s*[,—-])/gim },
    { label: 'kind of', re: /\b(?:kind|sort) of(?=\s*[,—-])/gim },
    { label: 'basically', re: /\bbasically\b/gi },
    { label: 'literally', re: /\bliterally\b/gi },
  ],
  es: [
    { label: 'eh', re: standalone('e+h+|e+m+|a+h+') },
    { label: 'mmm', re: standalone('m{2,}') },
    { label: 'este', re: /(?:^|[,.!?¿¡—-]\s*)este(?=\s*[,—-])/gim },
    { label: 'o sea', re: standalone('o sea') },
    { label: 'pues', re: /(?:^|[,.!?¿¡—-]\s*)pues(?=\s*[,—-])/gim },
    { label: 'bueno', re: /(?:^|[.!?¿¡—-]\s*)bueno(?=\s*[,—-])/gim },
    { label: 'tipo', re: /(?:^|[,—-]\s*)tipo(?=\s*[,—-])/gim },
    { label: 'como que', re: standalone('como que') },
    { label: '¿sabes?', re: /¿?\s*sabes\s*\?/gi },
    { label: 'digamos', re: standalone('digamos') },
    { label: 'en plan', re: standalone('en plan') },
  ],
};

export function countFillers(text: string, language: DeliveryLanguage): { count: number; found: Record<string, number> } {
  const found: Record<string, number> = {};
  let count = 0;
  for (const { label, re } of FILLERS[language]) {
    const n = (text.match(re) ?? []).length;
    if (n > 0) {
      found[label] = (found[label] ?? 0) + n;
      count += n;
    }
  }
  return { count, found };
}

const NOT_LETTER = `(?![${LETTER}])`;
const LEADING_NOISE: Record<DeliveryLanguage, RegExp> = {
  en: /^(?:[\s"“”'‘’¿¡—–,-]+|(?:and|but|so|well|okay|ok|look|listen|honestly|um+|uh+)\b[\s,]*)+/i,
  es: new RegExp(`^(?:[\\s"“”'‘’¿¡—–,-]+|(?:y|pero|entonces|bueno|mira|oye|pues|eh+|mm+)${NOT_LETTER}[\\s,]*)+`, 'i'),
};
const I_START: Record<DeliveryLanguage, RegExp> = {
  en: new RegExp(`^i(?:['’](?:m|ve|d|ll))?${NOT_LETTER}`, 'i'),
  es: new RegExp(`^(?:yo|me siento|siento|quiero|necesito|estoy|tengo miedo|me preocupa|me preocupas|me duele|me da miedo|te quiero|te amo|me importas)${NOT_LETTER}`, 'i'),
};
const YOU_START: Record<DeliveryLanguage, RegExp> = {
  en: new RegExp(`^(?:you(?:['’](?:re|ve|d|ll))?|your)${NOT_LETTER}`, 'i'),
  es: new RegExp(`^(?:t[úu]|usted|eres|est[áa]s|siempre|nunca|deber[íi]as|tienes que|te la pasas)${NOT_LETTER}`, 'i'),
};

/** "I" statements vs "you" statements (by how each sentence starts) and questions asked. */
export function countStatements(text: string, language: DeliveryLanguage): { i: number; you: number; questions: number } {
  let i = 0;
  let you = 0;
  for (const raw of text.split(/[.!?…\n]+|(?=¿)/)) {
    const sentence = raw.replace(LEADING_NOISE[language], '').trim();
    if (!sentence) continue;
    if (I_START[language].test(sentence)) i += 1;
    else if (YOU_START[language].test(sentence)) you += 1;
  }
  const questions = (text.match(/\?+/g) ?? []).length;
  return { i, you, questions };
}

/**
 * Loudness spikes in one recording: stretches (≥ 2 samples) well above the
 * speaker's own voiced baseline and near the top of the meter — a voice
 * rising under pressure, not ordinary emphasis.
 */
export function loudnessSpikes(metering: readonly number[] | undefined): { voiced: boolean; spikes: number; peakDb: number | null } {
  const samples = (metering ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v)).slice(-MAX_METERING_SAMPLES);
  const voiced = samples.filter((v) => v > -45);
  if (voiced.length < 5) return { voiced: false, spikes: 0, peakDb: null };
  const sorted = [...voiced].sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(baseline + 15, -12);
  let spikes = 0;
  let run = 0;
  for (const v of samples) {
    if (v >= threshold) {
      run += 1;
      if (run === 2) spikes += 1;
    } else {
      run = 0;
    }
  }
  return { voiced: true, spikes, peakDb: Math.round(sorted[sorted.length - 1]) };
}

function normalizeWords(text: string): string[] {
  return text.toLowerCase().match(new RegExp(`[${LETTER}0-9]+`, 'g')) ?? [];
}

/**
 * The clips that actually made it into a sent line: the draft is built from
 * transcripts but the member may edit or clear it before sending, so a clip
 * counts only if most of its words are still there.
 */
export function clipsForText(clips: readonly VoiceClip[], text: string): VoiceClip[] {
  const sent = new Set(normalizeWords(text));
  return clips.filter((clip) => {
    const words = normalizeWords(clip.transcript);
    if (words.length === 0) return false;
    const kept = words.filter((w) => sent.has(w)).length;
    return kept / words.length >= 0.5;
  });
}

export type AnalyzeOptions = {
  /** The first turn delivered a prepared letter/invitation — leave it out of turn-length coaching. */
  deliveredFirst?: boolean;
};

export function analyzeDelivery(
  turns: readonly DeliveryTurn[],
  language: DeliveryLanguage,
  options: AnalyzeOptions = {},
): DeliveryReport | null {
  const userTurns = turns.filter((t) => t.text.trim().length > 0);
  if (userTurns.length === 0) return null;

  let spokenWords = 0;
  let spokenMs = 0;
  let fillerCount = 0;
  const fillerTally: Record<string, number> = {};
  let voiceTurns = 0;
  let meteredTurns = 0;
  let spikeTurns = 0;
  let peakDb: number | null = null;
  let iStatements = 0;
  let youStatements = 0;
  let questions = 0;

  for (const turn of userTurns) {
    const s = countStatements(turn.text, language);
    iStatements += s.i;
    youStatements += s.you;
    questions += s.questions;

    const clips = (turn.clips ?? []).filter((c) => c.transcript.trim() && c.durationMs > 0);
    if (clips.length === 0) continue;
    voiceTurns += 1;
    let metered = false;
    let spiked = false;
    for (const clip of clips) {
      const words = wordCount(clip.transcript);
      // Sub-second clips and single words distort pace more than they inform it.
      if (clip.durationMs >= 1000 && words >= 2) {
        spokenWords += words;
        spokenMs += clip.durationMs;
      }
      const fillers = countFillers(clip.transcript, language);
      fillerCount += fillers.count;
      for (const [label, n] of Object.entries(fillers.found)) fillerTally[label] = (fillerTally[label] ?? 0) + n;
      const loud = loudnessSpikes(clip.metering);
      if (loud.voiced) {
        metered = true;
        if (loud.spikes > 0) spiked = true;
        if (loud.peakDb !== null) peakDb = peakDb === null ? loud.peakDb : Math.max(peakDb, loud.peakDb);
      }
    }
    if (metered) meteredTurns += 1;
    if (spiked) spikeTurns += 1;
  }

  const lengthTurns = options.deliveredFirst && userTurns.length > 1 ? userTurns.slice(1) : userTurns;
  const avgTurnWords = Math.round(
    lengthTurns.reduce((sum, t) => sum + wordCount(t.text), 0) / Math.max(1, lengthTurns.length),
  );
  const spokenAny = voiceTurns > 0;
  const wordsPerMinute = spokenMs >= 3000 && spokenWords >= 8 ? Math.round(spokenWords / (spokenMs / 60000)) : null;
  const allSpokenWords = userTurns.reduce(
    (sum, t) => sum + (t.clips ?? []).reduce((s, c) => s + wordCount(c.transcript), 0),
    0,
  );
  const topFillers = Object.entries(fillerTally)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
    .slice(0, 3);
  const loudness = meteredTurns > 0 && peakDb !== null ? { meteredTurns, spikeTurns, peakDb } : null;

  const report: DeliveryReport = {
    userTurns: userTurns.length,
    voiceTurns,
    wordsPerMinute,
    fillerCount: spokenAny ? fillerCount : null,
    topFillers,
    iStatements,
    youStatements,
    questions,
    avgTurnWords,
    loudness,
    tips: [],
  };
  report.tips = deliveryTips(report, allSpokenWords, lengthTurns.length);
  return report;
}

/** Plain-language coaching, most useful first: up to three things to work on, then what went right. */
export function deliveryTips(report: DeliveryReport, spokenWords: number, lengthTurns = report.userTurns): DeliveryTip[] {
  const work: DeliveryTip[] = [];
  const strengths: DeliveryTip[] = [];
  const fillerRate = report.fillerCount !== null && spokenWords > 0 ? (report.fillerCount / spokenWords) * 100 : null;

  if (report.wordsPerMinute !== null) {
    if (report.wordsPerMinute > 170) work.push({ key: 'paceFast', vars: { wpm: report.wordsPerMinute } });
    else if (report.wordsPerMinute >= 100) strengths.push({ key: 'paceSteady', vars: { wpm: report.wordsPerMinute } });
  }
  if (report.fillerCount !== null && fillerRate !== null) {
    if (report.fillerCount >= 3 && fillerRate >= 3) {
      work.push({ key: 'fillersHigh', vars: { count: report.fillerCount, examples: report.topFillers.join(', ') } });
    } else if (spokenWords >= 25 && fillerRate < 1.5) {
      strengths.push({ key: 'fillersLow', vars: {} });
    }
  }
  if (report.youStatements >= 2 && report.youStatements > report.iStatements) {
    work.push({ key: 'youHeavy', vars: { you: report.youStatements, i: report.iStatements } });
  } else if (report.iStatements >= 2) {
    strengths.push({ key: 'iStrong', vars: { count: report.iStatements } });
  }
  if (report.avgTurnWords > 55 && lengthTurns >= 2) {
    work.push({ key: 'longTurns', vars: { words: report.avgTurnWords } });
  } else if (report.avgTurnWords > 0 && report.avgTurnWords <= 35 && lengthTurns >= 2) {
    strengths.push({ key: 'shortTurns', vars: { words: report.avgTurnWords } });
  }
  if (report.loudness) {
    const { meteredTurns, spikeTurns } = report.loudness;
    if (spikeTurns >= 1 && spikeTurns / meteredTurns >= 0.34) {
      work.push({ key: 'loudPeaks', vars: { count: spikeTurns, total: meteredTurns } });
    } else if (meteredTurns >= 2 && spikeTurns === 0) {
      strengths.push({ key: 'steadyVolume', vars: {} });
    }
  }
  if (report.questions === 0 && report.userTurns >= 3) work.push({ key: 'noQuestions', vars: {} });
  else if (report.questions >= 1) strengths.push({ key: 'questionsAsked', vars: { count: report.questions } });

  return [...work.slice(0, strengths.length > 0 ? 3 : 4), ...strengths].slice(0, 4);
}

const TIP_KEYS = new Set<DeliveryTipKey>([
  'paceFast', 'fillersHigh', 'youHeavy', 'longTurns', 'loudPeaks', 'noQuestions',
  'paceSteady', 'fillersLow', 'iStrong', 'questionsAsked', 'steadyVolume', 'shortTurns',
]);

/** Reads a stored report back (history) — tolerant of missing or older shapes. */
export function readDeliveryReport(raw: unknown): DeliveryReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const userTurns = num(r.userTurns);
  if (userTurns === null) return null;
  const tips = (Array.isArray(r.tips) ? r.tips : [])
    .filter((tip): tip is DeliveryTip =>
      !!tip && typeof tip === 'object' && TIP_KEYS.has((tip as DeliveryTip).key) &&
      !!(tip as DeliveryTip).vars && typeof (tip as DeliveryTip).vars === 'object')
    .slice(0, 4);
  const l = r.loudness as Record<string, unknown> | null | undefined;
  return {
    userTurns,
    voiceTurns: num(r.voiceTurns) ?? 0,
    wordsPerMinute: num(r.wordsPerMinute),
    fillerCount: num(r.fillerCount),
    topFillers: (Array.isArray(r.topFillers) ? r.topFillers : []).filter((x): x is string => typeof x === 'string').slice(0, 3),
    iStatements: num(r.iStatements) ?? 0,
    youStatements: num(r.youStatements) ?? 0,
    questions: num(r.questions) ?? 0,
    avgTurnWords: num(r.avgTurnWords) ?? 0,
    loudness: l && num(l.meteredTurns) !== null && num(l.spikeTurns) !== null && num(l.peakDb) !== null
      ? { meteredTurns: num(l.meteredTurns)!, spikeTurns: num(l.spikeTurns)!, peakDb: num(l.peakDb)! }
      : null,
    tips,
  };
}
