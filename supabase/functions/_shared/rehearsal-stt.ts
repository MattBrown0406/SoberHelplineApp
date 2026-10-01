// Speech-to-text post-processing for the Rehearsal Partner (pure, tested in
// rehearsal-stt_test.ts).
import { coveredByRuns } from './rehearsal-safety.ts';

// Whisper normally scrubs disfluencies ("um", "uh", "I mean"), which would
// make the debrief's filler-word feedback blind. A short prompt made only of
// fillers keeps them in the transcript. It is deliberately not a sentence: a
// natural prompt ("I wanted to talk to you") would collide with real speech
// when its echo is stripped.
export const DISFLUENCY_PROMPT: Record<'en' | 'es', string> = {
  en: 'Umm, uh, like, you know, I mean, hmm... so, uh, um.',
  es: 'Eh, este, mmm, o sea, bueno, pues, eh... este, mmm.',
};

/**
 * On near-silence Whisper can echo its prompt back. It is an echo only when
 * the transcript is made entirely of runs (≥ 4 consecutive words) of the
 * prompt, or opens with the prompt's first 6+ words — compared word by word,
 * so a spoken "No." or "Bueno." is never mistaken for part of the prompt.
 */
export function stripPromptEcho(text: string, prompt: string): string {
  const { spans, covered } = coveredByRuns(text, prompt, 4);
  if (spans.length === 0) return '';
  if (covered.every(Boolean)) return '';
  const promptWords = coveredByRuns(prompt, prompt, 1).spans.map((s) => s.word);
  let lead = 0;
  while (lead < spans.length && lead < promptWords.length && spans[lead].word === promptWords[lead]) lead++;
  if (lead >= 6) return text.slice(spans[lead].start).trim();
  return text;
}

// Whisper hallucinates on silence/noise — it fills the void with phrases it
// saw constantly in training. A slipped finger on the hold-to-speak bar used
// to become "Thank you" or "You" in the input box.
const WHISPER_HALLUCINATIONS = new Set([
  // English
  'you', 'thank you', 'thank you so much', 'thanks', 'thanks for watching',
  'thank you for watching', 'bye', 'bye bye', 'okay', 'so', 'the', 'oh', 'uh', 'um',
  // Spanish
  'gracias', 'muchas gracias', 'gracias por ver', 'gracias por ver el video',
  'adios', 'adiós', 'hasta luego',
]);

export type WhisperSegment = { no_speech_prob?: number; avg_logprob?: number; text?: string };

/**
 * Silence, or a known silence hallucination. A lone "You." or "So?" is kept
 * when Whisper was confident it heard speech (low no-speech probability, good
 * log-probability on every segment) — people do say those.
 */
export function isLikelySilence(text: string, segments?: readonly WhisperSegment[] | null): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[.,!?¡¿'"“”\-…]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return true;
  // Whisper's infamous subtitle-credit hallucinations (any language)
  if (norm.startsWith('subtitulos') || norm.startsWith('subtítulos') || norm.includes('amara org')) return true;
  if (!WHISPER_HALLUCINATIONS.has(norm)) return false;
  const confident = !!segments?.length && segments.every((s) =>
    typeof s.no_speech_prob === 'number' && s.no_speech_prob < 0.1 &&
    typeof s.avg_logprob === 'number' && s.avg_logprob > -0.6
  );
  return !confident;
}
